/* 曲のテンポ(BPM)と、キー(調)を、おおまかに調べる。AI は使わない。端末の中だけで動く。 */
(function(){
 function fft(re,im){
  var n=re.length,i,j,k,t;
  for(i=1,j=0;i<n;i++){var bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t}}
  for(var len=2;len<=n;len<<=1){var h=len>>1,ang=-2*Math.PI/len,wr=Math.cos(ang),wi=Math.sin(ang);
   for(i=0;i<n;i+=len){var cr=1,ci=0;for(k=0;k<h;k++){var a=i+k,b=a+h,xr=re[b]*cr-im[b]*ci,xi=re[b]*ci+im[b]*cr;re[b]=re[a]-xr;im[b]=im[a]-xi;re[a]+=xr;im[a]+=xi;var t2=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=t2}}}
 }
 function mono22k(L,R,sr){ // 22050Hz のモノラルにする(単純に平均して間引く)
  var f=sr/22050,n=Math.floor(L.length/f),o=new Float32Array(n);
  for(var i=0;i<n;i++){var a=Math.floor(i*f),b=Math.max(a+1,Math.floor((i+1)*f)),s=0;for(var k=a;k<b;k++)s+=(L[k]+R[k])*0.5;o[i]=s/(b-a)}
  return o;
 }
 function hann(n){var w=new Float32Array(n);for(var i=0;i<n;i++)w[i]=0.5-0.5*Math.cos(2*Math.PI*i/n);return w}

 // ---- テンポ ----
 function tempo(x){
  var N=1024,HOP=512,W=hann(N),frames=Math.floor((x.length-N)/HOP);
  if(frames<200)return null;
  var re=new Float64Array(N),im=new Float64Array(N),prev=new Float32Array(N/2),flux=new Float32Array(frames);
  for(var f=0;f<frames;f++){
   for(var i=0;i<N;i++){re[i]=x[f*HOP+i]*W[i];im[i]=0}
   fft(re,im);var s=0;
   for(var b=2;b<N/2;b++){var m=Math.log(1+100*Math.sqrt(re[b]*re[b]+im[b]*im[b]));var d=m-prev[b];if(d>0)s+=d;prev[b]=m}
   flux[f]=s;
  }
  // 平均を引いて、整える
  var mean=0;for(f=0;f<frames;f++)mean+=flux[f];mean/=frames;
  var x2=new Float32Array(frames);for(f=0;f<frames;f++)x2[f]=Math.max(0,flux[f]-mean);
  var fps=22050/HOP,minLag=Math.floor(fps*60/200),maxLag=Math.ceil(fps*60/60),ac=new Float64Array(maxLag+2);
  for(var lag=minLag-1;lag<=maxLag+1;lag++){var sum=0;for(f=lag;f<frames;f++)sum+=x2[f]*x2[f-lag];ac[lag]=sum/(frames-lag)}
  var best=-1,bi=0;
  for(lag=minLag;lag<=maxLag;lag++){
   var bpm=60*fps/lag,w=Math.exp(-0.5*Math.pow(Math.log2(bpm/120)/0.7,2)); // 120付近を、少し選びやすくする
   var v=ac[lag]*w;if(ac[lag]>=ac[lag-1]&&ac[lag]>=ac[lag+1]&&v>best){best=v;bi=lag}
  }
  if(best<=0)return null;
  var y0=ac[bi-1],y1=ac[bi],y2=ac[bi+1],den=y0-2*y1+y2,off=den!==0?0.5*(y0-y2)/den:0;
  var bpm0=60*fps/(bi+off);
  return {bpm:bpm0};
 }

 // ---- キー ----
 var NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
 var MAJ=[6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88],MIN=[6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
 function corr(a,b){var ma=0,mb=0,i;for(i=0;i<12;i++){ma+=a[i];mb+=b[i]}ma/=12;mb/=12;var n=0,da=0,db=0;for(i=0;i<12;i++){n+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)*(a[i]-ma);db+=(b[i]-mb)*(b[i]-mb)}return n/Math.sqrt(da*db+1e-12)}
 function key(x){
  var N=8192,HOP=4096,W=hann(N),frames=Math.floor((x.length-N)/HOP);
  if(frames<4)return null;
  var re=new Float64Array(N),im=new Float64Array(N),chroma=new Float64Array(12),hz=22050/N,map=new Int16Array(N/2).fill(-1);
  for(var b=1;b<N/2;b++){var f=b*hz;if(f<65||f>2000)continue;map[b]=((Math.round(12*Math.log2(f/440))+9)%12+12)%12} // 440Hz は A(9)
  var step=Math.max(1,Math.floor(frames/120)); // 長い曲は、間引いて調べる
  for(var fr=0;fr<frames;fr+=step){
   for(var i=0;i<N;i++){re[i]=x[fr*HOP+i]*W[i];im[i]=0}
   fft(re,im);var loc=new Float64Array(12),tot=0;
   for(b=1;b<N/2;b++){if(map[b]<0)continue;var m=Math.sqrt(re[b]*re[b]+im[b]*im[b]);m=Math.sqrt(m);loc[map[b]]+=m;tot+=m}
   if(tot>0)for(i=0;i<12;i++)chroma[i]+=loc[i]/tot;
  }
  var res=[];
  for(var k=0;k<12;k++){
   var pm=new Array(12),pn=new Array(12);for(i=0;i<12;i++){pm[i]=MAJ[(i-k+12)%12];pn[i]=MIN[(i-k+12)%12]}
   res.push({k:k,minor:false,c:corr(chroma,pm)});res.push({k:k,minor:true,c:corr(chroma,pn)});
  }
  res.sort(function(a,b){return b.c-a.c});
  return {top:res[0],second:res[1]};
 }
 function keyName(r){return NAMES[r.k]+(r.minor?' マイナー':' メジャー')}
 function relative(r){return r.minor?NAMES[(r.k+3)%12]+' メジャー':NAMES[(r.k+9)%12]+' マイナー'}

 window.Analyze={
  run:function(L,R,sr){
   var x=mono22k(L,R,sr),t=null,k=null;
   try{t=tempo(x)}catch(e){}try{k=key(x)}catch(e){}
   return {bpm:t?t.bpm:null,key:k?{name:keyName(k.top),rel:relative(k.top),conf:k.top.c-k.second.c,score:k.top.c}:null};
  },
  text:function(r){
   var s=[];
   if(r.bpm){var b=r.bpm;s.push('テンポ: 約 '+Math.round(b)+' BPM(倍にすると '+Math.round(b*2)+'、半分なら '+Math.round(b/2)+')')}
   if(r.key){s.push('キー: '+r.key.name+(r.key.conf<0.03?'(自信は低め)':'')+(' ・ 同じ音階の別名: '+r.key.rel))}
   return s.join('  /  ');
  }
 };
})();
