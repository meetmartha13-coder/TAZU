/* TAZU driver verification and passenger trip-sharing UI. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const cloud=()=>window.TAZUCloud&&TAZUCloud.client();
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function note(el,msg,bad){if(el){el.textContent=msg;el.style.color=bad?'#9b2c20':'#087443';}}
 async function user(){const u=await TAZUCloud.currentUser();if(!u)throw Error('Please sign in first.');return u;}

 async function installAdmin(){
  try{
   const u=await user();
   if(u.app_metadata?.role!=='admin'||$('tazuAdminPanel'))return;
   const panel=document.createElement('section');panel.id='tazuAdminPanel';panel.className='panel';panel.style.margin='16px';
   panel.innerHTML='<h2>TAZU administrator · Driver verification</h2><p class="sub">Review each required document. A driver is approved only after all five document types are approved.</p><button id="tazuAdminRefresh" class="btn secondary" type="button">Refresh submissions</button><div id="tazuAdminList" class="history"></div>';
   document.querySelector('.app')?.insertBefore(panel,document.querySelector('.main'));
   $('tazuAdminRefresh').addEventListener('click',loadAdminDocuments);
   await loadAdminDocuments();
  }catch(e){console.warn('TAZU admin panel unavailable:',e.message)}
 }
 async function loadAdminDocuments(){
  const list=$('tazuAdminList');if(!list)return;
  list.textContent='Loading driver submissions…';
  try{
   const {data,error}=await cloud().from('driver_verification').select('id,user_id,document_type,storage_path,review_status,submitted_at,review_note').order('submitted_at',{ascending:false});
   if(error)throw error;
   if(!data?.length){list.textContent='No driver documents have been submitted.';return}
   list.innerHTML='';
   for(const d of data){
    const item=document.createElement('div');item.className='receipt';
    const head=document.createElement('div');head.className='line';
    const title=document.createElement('strong');title.textContent=d.document_type.replace(/_/g,' ');
    const status=document.createElement('span');status.textContent=d.review_status;
    head.append(title,status);item.append(head);
    const who=document.createElement('small');who.textContent='Driver account: '+d.user_id+' · '+new Date(d.submitted_at).toLocaleString();item.append(who);
    const {data:file,error:fileError}=await cloud().storage.from('tazu-driver-verification').createSignedUrl(d.storage_path,300);
    if(!fileError&&file?.signedUrl){const a=document.createElement('a');a.href=file.signedUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open document (5-minute link)';a.style.display='block';a.style.margin='8px 0';item.append(a)}
    else{const warn=document.createElement('small');warn.textContent='Document preview unavailable: '+(fileError?.message||'unknown error');item.append(warn)}
    if(d.review_status==='pending'){
     const actions=document.createElement('div');actions.style.display='flex';actions.style.gap='8px';
     for(const [label,value] of [['Approve','approved'],['Reject','rejected']]){
      const b=document.createElement('button');b.type='button';b.className='btn secondary';b.textContent=label;b.style.flex='1';
      b.addEventListener('click',async()=>{
       b.disabled=true;
       try{const {data:approved,error}=await cloud().rpc('review_driver_verification',{p_document_id:d.id,p_status:value,p_note:null});if(error)throw error;note($('tazuAdminList'),value==='approved'?(approved?'All five document types approved. Driver is now approved.':'Document approved. More required documents must be approved before the driver can go online.'):'Document rejected. Driver remains unapproved.');await loadAdminDocuments()}
       catch(e){note($('tazuAdminList'),e.message,true);b.disabled=false}
      });actions.append(b)
     }
     item.append(actions)
    }
    list.append(item)
   }
  }catch(e){list.textContent='Administrator review unavailable: '+e.message}
 }
 function install(){
  const driver=$('driverAvailabilityPanel');
  if(driver&&!$('tazuVerifyPanel')){
   const box=document.createElement('div');box.id='tazuVerifyPanel';box.className='receipt';box.style.marginTop='12px';
   box.innerHTML='<h2>Driver verification</h2><p class="sub">Upload clear, valid documents. Your account stays pending until TAZU reviews and approves them.</p><label class="field" for="tazuDocType">DOCUMENT TYPE</label><div class="inputwrap"><select id="tazuDocType"><option value="government_id">Government-issued ID</option><option value="drivers_license">Driver’s licence</option><option value="vehicle_registration">Vehicle registration</option><option value="vehicle_insurance">Vehicle insurance</option><option value="vehicle_photo">Vehicle photo</option></select></div><label class="field" for="tazuDocFile">DOCUMENT FILE (JPG, PNG OR PDF; MAX 10 MB)</label><input id="tazuDocFile" type="file" accept="image/jpeg,image/png,application/pdf" style="width:100%;padding:10px 0"><button id="tazuUploadDoc" class="btn secondary" type="button">Submit document securely</button><div id="tazuVerifyStatus" class="notice" role="status">Documents are stored privately and visible only to authorised reviewers.</div><div id="tazuVerifyList" class="history"></div>';
   driver.appendChild(box);
   $('tazuUploadDoc').addEventListener('click',uploadDocument);
  }
  const trip=$('passengerTripPanel');
  if(trip&&!$('tazuSharePanel')){
   const box=document.createElement('div');box.id='tazuSharePanel';box.className='receipt';
   box.innerHTML='<h2>Share your trip</h2><p class="sub">Create a private, time-limited link for someone you trust. You can revoke it at any time.</p><button id="tazuCreateShare" class="btn secondary" type="button">Create trip-sharing link</button><div id="tazuShareStatus" class="notice" role="status">Sharing is available after a driver accepts your ride.</div><button id="tazuRevokeShare" class="btn secondary hidden" type="button">Revoke active link</button>';
   trip.appendChild(box);
   $('tazuCreateShare').addEventListener('click',createShare);
   $('tazuRevokeShare').addEventListener('click',revokeShare);
  }
 }
 async function uploadDocument(){
  const b=$('tazuUploadDoc'),f=$('tazuDocFile')?.files?.[0],type=$('tazuDocType')?.value;
  if(!f){note($('tazuVerifyStatus'),'Choose a document file first.',true);return}
  if(!['image/jpeg','image/png','application/pdf'].includes(f.type)||f.size>10*1024*1024){note($('tazuVerifyStatus'),'Use a JPG, PNG or PDF file no larger than 10 MB.',true);return}
  b.disabled=true;
  try{
   const u=await user(),c=cloud(),path=u.id+'/'+crypto.randomUUID()+'-'+f.name.replace(/[^a-zA-Z0-9._-]/g,'_');
   const up=await c.storage.from('tazu-driver-verification').upload(path,f,{contentType:f.type,upsert:false});
   if(up.error)throw up.error;
   const {error}=await c.from('driver_verification').insert({user_id:u.id,document_type:type,storage_path:path});
   if(error){await c.storage.from('tazu-driver-verification').remove([path]);throw error}
   note($('tazuVerifyStatus'),'Document submitted securely. Status: pending review.');
   $('tazuDocFile').value='';await loadDocuments();
  }catch(e){note($('tazuVerifyStatus'),e.message||'Document upload failed.',true)}
  finally{b.disabled=false}
 }
 async function loadDocuments(){
  try{const u=await user(),{data,error}=await cloud().from('driver_verification').select('document_type,review_status,submitted_at').eq('user_id',u.id).order('submitted_at',{ascending:false});if(error)throw error;
   $('tazuVerifyList').innerHTML=(data||[]).map(x=>'<div class="historyitem"><span>'+esc(x.document_type.replace(/_/g,' '))+'</span><strong>'+esc(x.review_status)+'</strong></div>').join('')||'<small>No documents submitted yet.</small>';
  }catch(e){note($('tazuVerifyStatus'),e.message,true)}
 }
 async function createShare(){
  const b=$('tazuCreateShare');b.disabled=true;
  try{
   const u=await user(),id=localStorage.getItem('tazu_last_cloud_ride_id');if(!id)throw Error('No current ride found.');
   const {data:ride,error:re}=await cloud().from('rides').select('id,status').eq('id',id).eq('passenger_id',u.id).maybeSingle();if(re)throw re;
   if(!ride||!['accepted','in_progress'].includes(ride.status))throw Error('Trip sharing becomes available when your driver accepts the ride.');
   const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
   const {error}=await cloud().rpc('create_trip_share',{p_ride_id:id,p_token:token});if(error)throw error;
   const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('share',token);
   await navigator.clipboard.writeText(url.toString());
   note($('tazuShareStatus'),'Secure trip link copied. It expires in 12 hours and can be revoked.');
   $('tazuRevokeShare').classList.remove('hidden');
  }catch(e){note($('tazuShareStatus'),e.message||'Could not create trip link.',true)}
  finally{b.disabled=false}
 }
 async function revokeShare(){
  try{const u=await user(),id=localStorage.getItem('tazu_last_cloud_ride_id');
   const {error}=await cloud().from('trip_shares').update({revoked_at:new Date().toISOString()}).eq('ride_id',id).eq('passenger_id',u.id).is('revoked_at',null);if(error)throw error;
   note($('tazuShareStatus'),'Trip-sharing link revoked.');$('tazuRevokeShare').classList.add('hidden');
  }catch(e){note($('tazuShareStatus'),e.message,true)}
 }
 async function showSharedTrip(){
  const token=new URLSearchParams(location.search).get('share');if(!token)return;
  document.querySelector('.main')?.classList.add('hidden');
  const main=document.createElement('main');main.className='main';main.innerHTML='<section class="panel"><h1>TAZU shared trip</h1><p class="sub">Live trip details shared by a passenger.</p><div id="tazuSharedDetails" class="receipt">Loading secure trip details…</div><p class="notice">This link is private and expires automatically. Contact the passenger if access is denied.</p></section>';
  document.querySelector('.app')?.insertBefore(main,document.querySelector('.footer'));
  async function refresh(){try{const {data,error}=await cloud().rpc('get_shared_trip',{p_token:token});if(error)throw error;if(!data){$('tazuSharedDetails').textContent='This link has expired, was revoked, or the trip is no longer active.';return}
   const live=data.driver_lat!=null&&data.driver_lng!=null?'<p><a rel="noopener" target="_blank" href="https://www.google.com/maps?q='+encodeURIComponent(data.driver_lat+','+data.driver_lng)+'">View driver’s latest live location on map</a></p>':'<small>Driver location will appear here while the trip is in progress and the driver’s GPS is updating.</small>';\n   $('tazuSharedDetails').innerHTML='<div class="line"><span>Pickup</span><strong>'+esc(data.pickup)+'</strong></div><div class="line"><span>Destination</span><strong>'+esc(data.destination)+'</strong></div><div class="line"><span>Trip status</span><strong>'+esc(data.status.replace(/_/g,' '))+'</strong></div><div class="line"><span>Ride type</span><strong>'+esc(data.ride_type)+'</strong></div>'+live+'<small>Updated '+esc(new Date(data.updated_at).toLocaleString())+'</small>';
  }catch(e){$('tazuSharedDetails').textContent='Unable to load shared trip: '+e.message}}
  await refresh();setInterval(refresh,10000);
 }
 window.addEventListener('load',()=>{install();installAdmin();showSharedTrip();setInterval(()=>{if($('tazuVerifyPanel')&&!$('tazuVerifyList').dataset.loaded){$('tazuVerifyList').dataset.loaded='1';loadDocuments()}},1200)});
})();
