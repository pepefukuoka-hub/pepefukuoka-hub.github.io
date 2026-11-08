const $=id=>document.getElementById(id);
let detector,stream,raf,lastVideoTime=-1,source='none',generation=0,busy=false,loading,lastPhotoResult=null;
const ctx=$('overlay').getContext('2d');
function status(text){$('status').textContent='● '+text;}
function error(text){$('error').textContent=text;$('error').hidden=!text;}
function result(text,state='pending'){const el=$('photo-result');el.textContent=text;el.dataset.state=state;el.hidden=!text;}
function controls(){ $('detect').disabled=busy||source!=='photo'; $('detect').textContent=busy&&source==='photo'?'検出しています…':'写真の顔を検出する'; $('start').disabled=busy||!!stream; $('stop').disabled=!stream; $('file').disabled=busy; }
async function load(){
 if(detector)return detector;
 if(!loading) loading=(async()=>{
  status('AIを準備中…（初回は少し時間がかかります）');
  const probe=document.createElement('canvas');
  const gl=probe.getContext('webgl2')||probe.getContext('webgl');
  if(!gl)throw new Error('webgl');
  const {FaceDetector,FilesetResolver}=await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/vision_bundle.mjs');
  const files=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm');
  detector=await FaceDetector.createFromOptions(files,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'},runningMode:'IMAGE',minDetectionConfidence:.5});
  return detector;
 })().catch(e=>{loading=null;throw e;});
 return loading;
}
function draw(result,media,w,h){
 const canvas=$('overlay');canvas.width=w;canvas.height=h;
 const iw=media.videoWidth||media.naturalWidth,ih=media.videoHeight||media.naturalHeight;
 const scale=Math.min(w/iw,h/ih),ox=(w-iw*scale)/2,oy=(h-ih*scale)/2;
 ctx.clearRect(0,0,w,h);ctx.strokeStyle='#bceaa0';ctx.fillStyle='#bceaa0';ctx.lineWidth=Math.max(2,w/450);
 for(const item of result.detections){const b=item.boundingBox;if(!b)continue;
 ctx.strokeRect(ox+b.originX*scale,oy+b.originY*scale,b.width*scale,b.height*scale);
 if($('points').checked)for(const p of item.keypoints||[]){ctx.beginPath();ctx.arc(ox+p.x*iw*scale,oy+p.y*ih*scale,Math.max(3,w/220),0,Math.PI*2);ctx.fill();}
 }
 $('count').textContent=result.detections.length;
}
function render(result,media){const stage=$('stage');draw(result,media,stage.clientWidth,stage.clientHeight);}
function mirror(){const value=source==='video'&&$('mirror').checked?'scaleX(-1)':'';$('video').style.transform=value;$('overlay').style.transform=value;}
function stop(reset=true){generation++;cancelAnimationFrame(raf);if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;lastVideoTime=-1;if(source==='video'){source='none';$('video').hidden=true;$('overlay').width=0;$('empty').hidden=false;$('count').textContent='—';}mirror();if(reset){status('待機中');$('timing').textContent='READY';}controls();}
function loop(token){if(token!==generation||!stream)return;
 try{const video=$('video');if(video.readyState>=2&&video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;const t=performance.now();render(detector.detectForVideo(video,t),video);$('timing').textContent=Math.round(performance.now()-t)+' ms / frame';status('検出中');}raf=requestAnimationFrame(()=>loop(token));}
 catch(e){stop();error('顔の検出を続けられませんでした。カメラを再起動してください。');console.error(e);}}
$('start').onclick=async()=>{
 if(busy)return;busy=true;error('');result('');lastPhotoResult=null;controls();stop(false);const token=generation;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
  await load();if(token!==generation)return;await detector.setOptions({runningMode:'VIDEO'});
  status('カメラの許可を待っています…');const next=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:'user',width:{ideal:960},height:{ideal:720}}});
  if(token!==generation){next.getTracks().forEach(t=>t.stop());return;}
  stream=next;source='video';$('video').srcObject=stream;await $('video').play();if(token!==generation)return;
  $('video').hidden=false;$('photo').hidden=true;$('empty').hidden=true;$('mode').textContent='LIVE VIEW';mirror();loop(token);
 }catch(e){stop();const message={NotAllowedError:'カメラが許可されていません。ブラウザのサイト設定でカメラを許可してください。',NotFoundError:'カメラが見つかりません。写真を選んで試せます。',NotReadableError:'カメラを使用できません。他のアプリで使用していないか確認してください。'};error(message[e.name]||(e.message==='webgl'?'このブラウザではWebGLを使えません。通常のSafariやChromeで開いてください。':e.message==='unsupported'?'このブラウザではカメラを使えません。HTTPSのページをSafariやChromeで開いてください。':'AIまたはカメラを準備できませんでした。通信環境を確認して、もう一度お試しください。'));console.error(e);
 }finally{busy=false;controls();}
};
$('stop').onclick=()=>stop();
$('file').onchange=async e=>{
 const file=e.target.files?.[0];if(!file||busy)return;
 if(!file.type.startsWith('image/')){error('画像ファイルを選んでください。');return;}
 busy=true;stop(false);controls();error('');lastPhotoResult=null;
 $('count').textContent='—';$('overlay').width=0;result('写真を読み込んでいます…');
 const token=generation,url=URL.createObjectURL(file);
 try{
  $('photo').src=url;await $('photo').decode();if(token!==generation)return;
  source='photo';$('photo').hidden=false;$('video').hidden=true;$('empty').hidden=true;
  $('mode').textContent='PHOTO VIEW';mirror();status('写真を選択しました');$('timing').textContent='未検出';
  result('写真を選択しました。「写真の顔を検出する」を押してください。');
 }catch(e){source='none';$('photo').hidden=true;$('empty').hidden=false;status('写真を読み込めませんでした');result('写真を読み込めませんでした。別のJPG・PNG画像を選んでください。','error');}
 finally{URL.revokeObjectURL(url);busy=false;controls();e.target.value='';}
};
$('detect').onclick=async()=>{
 if(busy||source!=='photo')return;
 busy=true;error('');lastPhotoResult=null;$('count').textContent='—';$('overlay').width=0;controls();
 const token=generation;
 result('検出しています… 初回はAIの読み込みに時間がかかります。');
 try{
  await load();if(token!==generation)return;
  await detector.setOptions({runningMode:'IMAGE'});
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(token!==generation)return;
  const t=performance.now();lastPhotoResult=detector.detect($('photo'));render(lastPhotoResult,$('photo'));
  const n=lastPhotoResult.detections.length;
  status('検出完了');$('timing').textContent=Math.round(performance.now()-t)+' ms';
  result(n>0?'検出完了：顔を'+n+'人検出しました。写真の緑の枠を確認してください。':'検出完了：顔が見つかりませんでした。明るく、顔が大きく正面に写った写真で試してください。',n>0?'success':'empty');
 }catch(e){
  status('検出できませんでした');$('timing').textContent='検出エラー';
  const message=e.message==='webgl'?'このブラウザではWebGLを使えません。SafariやChromeで開いてください。':'AIの読み込み、または検出に失敗しました。通信環境を確認し、もう一度ボタンを押してください。';
  result('検出エラー：'+message,'error');error(message);console.error(e);
 }finally{busy=false;controls();}
};
$('mirror').onchange=mirror;
function redraw(){if(source==='photo'&&lastPhotoResult&&!busy)render(lastPhotoResult,$('photo'));}
$('points').onchange=redraw;window.addEventListener('resize',redraw);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&stream)stop();});
window.addEventListener('pagehide',()=>stop());
