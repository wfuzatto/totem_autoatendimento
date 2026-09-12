(()=>{
  const B=window.TOTEM_BASE||'';
  const app=document.getElementById('app');
  const modalRoot=document.getElementById('modalRoot');
  const gateway=`${B}/face-api.php`;
  const previousFetch=window.fetch.bind(window);
  let faceConfig={enabled:false};
  let bundle=null;
  let prepared=null;
  let prepareSequence=0;
  let settingsInjecting=false;

  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function requestUrl(input){
    try{return new URL(typeof input==='string'?input:input?.url,location.href)}catch(_){return null}
  }

  function apiAction(input){
    const u=requestUrl(input);
    if(!u||!u.pathname.endsWith('/api.php'))return '';
    return u.searchParams.get('action')||'';
  }

  // Carrega antes do núcleo V2 para acompanhar qual reserva/hóspede está no fluxo,
  // sem expor a API key do microserviço ao navegador.
  window.fetch=async function(input,init){
    const response=await previousFetch(input,init);
    try{
      if(response.ok){
        const action=apiAction(input);
        if(['lookup','reservation_bundle','face_verify'].includes(action)){
          const data=await response.clone().json();
          if(data?.reservation && Array.isArray(data?.guests)) bundle=data;
          else if(data?.bundle?.reservation && Array.isArray(data?.bundle?.guests)) bundle=data.bundle;
        }
      }
    }catch(_){ }
    return response;
  };

  async function gatewayJson(action,{method='GET',data=null}={}){
    const options={method,headers:{'Accept':'application/json'}};
    if(data!==null){options.headers['Content-Type']='application/json';options.body=JSON.stringify(data)}
    const response=await fetch(`${gateway}?action=${encodeURIComponent(action)}`,options);
    const json=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(json.error||json.detail||`Erro ${response.status}`);
    return json;
  }

  async function loadFaceConfig(){
    try{
      const data=await gatewayJson('config');
      faceConfig.enabled=!!data.enabled;
    }catch(error){
      console.warn('[TOTEM] Não foi possível ler configuração do Face Scanner:',error);
      faceConfig.enabled=false;
    }
    if(faceConfig.enabled)queueMicrotask(enhanceFaceScreen);
  }

  function currentAdult(){
    return bundle?.guests?.find?.(g=>!!g.adult&&!g.face_verified)||null;
  }

  function statusNode(){return document.getElementById('faceScannerStatus')}

  function setStatus(message,type=''){
    const node=statusNode();
    if(!node)return;
    node.className=`face-scanner-status${type?` is-${type}`:''}`;
    node.innerHTML=message;
  }

  function personPlaceholder(message){
    return `<div class="face-reference-placeholder"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path></svg><strong>${esc(message)}</strong></div>`;
  }

  async function enhanceFaceScreen(){
    if(!faceConfig.enabled)return;
    const button=document.getElementById('captureFace');
    const video=document.getElementById('faceVideo');
    const cameraBox=video?.closest('.camera-box');
    if(!button||!video||!cameraBox||!bundle?.reservation)return;

    const guest=currentAdult();
    if(!guest)return;
    if(button.dataset.faceScannerGuest===String(guest.id))return;

    button.dataset.faceScannerGuest=String(guest.id);
    button.disabled=true;
    prepared=null;
    const sequence=++prepareSequence;

    const instruction=document.createElement('div');
    instruction.className='face-scanner-instruction';
    instruction.innerHTML=`<strong>Validação de ${esc(guest.name)}</strong><span>Confira a foto do documento. Somente esta pessoa deve se posicionar em frente à webcam.</span>`;

    const grid=document.createElement('div');
    grid.className='face-compare-grid';
    const reference=document.createElement('section');
    reference.className='face-reference-card';
    reference.innerHTML=`<div class="face-reference-head"><strong>Foto do documento</strong><small>${esc(guest.name)}</small></div><div class="face-reference-photo" id="faceReferencePhoto"><div class="face-reference-placeholder"><div class="face-reference-spinner"></div><strong>Analisando documento...</strong><span>Localizando o retrato do hóspede</span></div></div>`;
    const live=document.createElement('section');
    live.className='face-live-card';
    live.innerHTML=`<div class="face-live-head"><strong>Webcam ao vivo</strong><small>Posicione ${esc(guest.name)} dentro da marcação</small></div>`;

    cameraBox.parentNode.insertBefore(instruction,cameraBox);
    cameraBox.parentNode.insertBefore(grid,cameraBox);
    grid.appendChild(reference);
    grid.appendChild(live);
    live.appendChild(cameraBox);

    const buttonWrap=button.parentElement;
    const status=document.createElement('div');
    status.id='faceScannerStatus';
    status.className='face-scanner-status is-working';
    status.textContent='Preparando o documento para comparação facial...';
    buttonWrap?.insertAdjacentElement('afterend',status);

    try{
      const result=await gatewayJson('prepare',{method:'POST',data:{
        reservation_id:Number(bundle.reservation.id),
        guest_id:Number(guest.id)
      }});
      if(sequence!==prepareSequence||!button.isConnected||String(button.dataset.faceScannerGuest)!==String(guest.id))return;

      const photo=document.getElementById('faceReferencePhoto');
      if(result?.portrait?.preview_data_url){
        if(photo)photo.innerHTML=`<img src="${result.portrait.preview_data_url}" alt="Foto extraída do documento de ${esc(guest.name)}">`;
      }else if(photo){
        photo.innerHTML=personPlaceholder(result?.portrait?.found?'Retrato localizado; prévia indisponível.':'Não foi possível localizar o retrato no documento.');
      }

      if(!result.ready||!result.verification_id){
        button.disabled=true;
        const warning=(result.warnings||[]).map(esc).join(' · ');
        setStatus(`<strong>Não foi possível iniciar a comparação facial.</strong>${warning?`<span class="face-scanner-attempts">${warning}</span>`:''}`,'error');
        return;
      }

      prepared={
        reservationId:Number(bundle.reservation.id),
        guestId:Number(guest.id),
        guestName:String(guest.name),
        verificationId:String(result.verification_id)
      };
      button.disabled=false;
      setStatus(`<strong>Documento preparado.</strong> Agora ${esc(guest.name)} deve olhar para a webcam.`,'ready');
    }catch(error){
      if(sequence!==prepareSequence||!button.isConnected)return;
      const photo=document.getElementById('faceReferencePhoto');
      if(photo)photo.innerHTML=personPlaceholder('Não foi possível preparar a foto do documento.');
      button.disabled=true;
      setStatus(`<strong>Validação facial indisponível.</strong><span class="face-scanner-attempts">${esc(error.message)}</span>`,'error');
    }
  }

  function webcamCapture(video){
    if(!video?.videoWidth||!video?.videoHeight)throw new Error('Aguarde a webcam inicializar.');
    const canvas=document.createElement('canvas');
    canvas.width=Math.min(960,video.videoWidth);
    canvas.height=Math.max(1,Math.round(canvas.width*video.videoHeight/video.videoWidth));
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)throw new Error('Não foi possível capturar a imagem da webcam.');
    ctx.drawImage(video,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.9);
  }

  document.addEventListener('click',async event=>{
    const button=event.target.closest?.('#captureFace');
    if(!button||!faceConfig.enabled)return;

    // O handler legado é preservado apenas para mandar o fluxo V2 avançar DEPOIS
    // que o servidor já confirmou o match biométrico.
    const legacyHandler=button.onclick;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if(button.dataset.faceScannerBusy==='1')return;
    const guest=currentAdult();
    if(!prepared||!guest||prepared.guestId!==Number(guest.id)){
      setStatus('Aguarde a preparação do documento antes de capturar.','warning');
      return;
    }

    try{
      button.dataset.faceScannerBusy='1';
      button.disabled=true;
      setStatus(`<strong>Comparando rostos...</strong><span class="face-scanner-attempts">Mantenha ${esc(prepared.guestName)} em frente à câmera.</span>`,'working');
      const capture=webcamCapture(document.getElementById('faceVideo'));
      const result=await gatewayJson('verify',{method:'POST',data:{
        reservation_id:prepared.reservationId,
        guest_id:prepared.guestId,
        verification_id:prepared.verificationId,
        capture
      }});

      if(result.bundle?.reservation)bundle=result.bundle;
      if(result.verified){
        setStatus(`<strong>Identidade confirmada.</strong> ${esc(prepared.guestName)} foi validado com sucesso.`,'ready');
        prepared=null;
        button.dataset.faceScannerBusy='0';
        // O endpoint legado está protegido no backend: após o match ele apenas
        // reconhece que o hóspede já foi validado e permite ao fluxo avançar.
        setTimeout(()=>{
          if(button.isConnected&&typeof legacyHandler==='function')legacyHandler.call(button);
        },450);
        return;
      }

      const face=result.face_result||{};
      const remaining=Number(face.attempts_remaining??0);
      const used=Number(face.attempts_used??0);
      const max=Number(face.max_attempts??3);
      const attempts=`Tentativa ${used} de ${max}${remaining>=0?` · ${remaining} restante(s)`:''}.`;
      if(result.retry_allowed){
        button.disabled=false;
        setStatus(`<strong>Não foi possível confirmar a identidade.</strong> ${esc(result.message)}<span class="face-scanner-attempts">${esc(attempts)} Ajuste a posição e tente novamente.</span>`,'warning');
      }else{
        prepared=null;
        button.disabled=true;
        setStatus(`<strong>Validação não concluída.</strong> ${esc(result.message)}<span class="face-scanner-attempts">${esc(attempts)} Solicite atendimento da recepção.</span>`,'error');
      }
    }catch(error){
      button.disabled=false;
      setStatus(`<strong>Falha na validação facial.</strong><span class="face-scanner-attempts">${esc(error.message)}</span>`,'error');
    }finally{
      button.dataset.faceScannerBusy='0';
    }
  },true);

  async function injectSettings(){
    if(settingsInjecting)return;
    const modal=modalRoot?.querySelector('.modal-card');
    if(!modal||!/Dashboard de configuração/i.test(modal.textContent||''))return;
    if(document.getElementById('faceScannerSettingsCard'))return;
    const integration=[...modal.querySelectorAll('.section-card')].find(card=>/^Integrações/i.test(card.querySelector('h3')?.textContent||''));
    if(!integration)return;

    settingsInjecting=true;
    try{
      const settings=await gatewayJson('settings_get');
      if(!modal.isConnected)return;
      const card=document.createElement('div');
      card.id='faceScannerSettingsCard';
      card.className='admin-section section-card face-scanner-settings';
      card.innerHTML=`<h3>Validação facial · Face Scanner</h3><label class="switch-line"><span><strong>Ativar Face Scanner</strong><small class="face-scanner-setting-note">Usa o microserviço YuNet + SFace para comparar o documento com a webcam.</small></span><input type="checkbox" id="faceScannerEnabled" ${String(settings.face_scanner_enabled)==='1'?'checked':''}></label><div class="settings-grid" style="margin-top:14px"><div><label class="form-label" for="faceScannerUrl">URL do serviço</label><input class="form-control" id="faceScannerUrl" value="${esc(settings.face_scanner_url||'http://127.0.0.1:8091')}" placeholder="http://127.0.0.1:8091"><small class="face-scanner-setting-note">A chamada é feita pelo PHP/XAMPP; esta URL não precisa ser acessível pelo navegador.</small></div><div><label class="form-label" for="faceScannerApiKey">API key</label><input type="password" class="form-control" id="faceScannerApiKey" value="${esc(settings.face_scanner_api_key||'')}" autocomplete="new-password"><small class="face-scanner-setting-note">A chave permanece somente no servidor e nunca é enviada ao JavaScript.</small></div></div><div class="face-scanner-settings-actions"><button type="button" class="btn btn-primary" id="saveFaceScanner">Salvar Face Scanner</button><button type="button" class="btn btn-outline-secondary" id="testFaceScanner">Testar conexão</button></div><div id="faceScannerHealth" class="face-scanner-health">Aguardando teste.</div>`;
      integration.insertAdjacentElement('afterend',card);

      const health=document.getElementById('faceScannerHealth');
      document.getElementById('saveFaceScanner')?.addEventListener('click',async()=>{
        const save=document.getElementById('saveFaceScanner');
        save.disabled=true;
        if(health){health.className='face-scanner-health';health.textContent='Salvando...'}
        try{
          const result=await gatewayJson('settings_save',{method:'POST',data:{
            face_scanner_enabled:document.getElementById('faceScannerEnabled').checked?'1':'0',
            face_scanner_url:document.getElementById('faceScannerUrl').value.trim(),
            face_scanner_api_key:document.getElementById('faceScannerApiKey').value
          }});
          faceConfig.enabled=!!result.enabled;
          if(health){health.className='face-scanner-health ok';health.textContent='Configuração do Face Scanner salva.'}
        }catch(error){
          if(health){health.className='face-scanner-health error';health.textContent=error.message}
        }finally{save.disabled=false}
      });

      document.getElementById('testFaceScanner')?.addEventListener('click',async()=>{
        const test=document.getElementById('testFaceScanner');
        test.disabled=true;
        if(health){health.className='face-scanner-health';health.textContent='Testando Face Scanner...'}
        try{
          const result=await gatewayJson('health');
          const h=result.health||{};
          const technicalReady=!!h.face_engine_ready&&!!h.embedding_model_ready&&!!h.provider_configured&&!!h.thresholds_configured;
          const details=`Versão ${esc(h.version||'—')} · detector ${h.face_engine_ready?'OK':'indisponível'} · SFace ${h.embedding_model_ready?'OK':'indisponível'} · provider ${h.provider_configured?'OK':'não configurado'} · thresholds ${h.thresholds_configured?'OK':'não configurados'}`;
          if(health){health.className=`face-scanner-health ${technicalReady?'ok':'error'}`;health.innerHTML=`${technicalReady?'<strong>Face Scanner pronto para comparação.</strong>':'<strong>Serviço respondeu, mas a biometria ainda não está pronta para aprovar identidade.</strong>'}<br>${details}`}
        }catch(error){
          if(health){health.className='face-scanner-health error';health.textContent=`Falha: ${error.message}`}
        }finally{test.disabled=false}
      });
    }catch(error){
      console.warn('[TOTEM] Falha ao adicionar configurações do Face Scanner:',error);
    }finally{
      settingsInjecting=false;
    }
  }

  if(app)new MutationObserver(()=>queueMicrotask(enhanceFaceScreen)).observe(app,{childList:true,subtree:true});
  if(modalRoot)new MutationObserver(()=>queueMicrotask(injectSettings)).observe(modalRoot,{childList:true,subtree:true});
  loadFaceConfig();
  window.TotemFaceScanner={reloadConfig:loadFaceConfig,enhance:enhanceFaceScreen};
})();
