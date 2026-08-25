(()=>{
  const B=window.TOTEM_BASE||'';
  const endpoint=`${B}/device-settings.php`;
  const prefs={onscreen_keyboard_enabled:true,qr_camera_device_id:''};
  const media=navigator.mediaDevices;
  const nativeGetUserMedia=media?.getUserMedia ? media.getUserMedia.bind(media) : null;
  let longPressTimer=null;
  let longPressTriggered=false;

  window.TOTEM_ONSCREEN_KEYBOARD_ENABLED=true;

  function flash(message,danger=false){
    const toast=document.getElementById('toast');
    if(!toast)return;
    toast.textContent=message;
    toast.style.background=danger?'#9d2430':'#1f3429';
    toast.classList.remove('hidden');
    clearTimeout(toast._deviceTimer);
    toast._deviceTimer=setTimeout(()=>toast.classList.add('hidden'),3200);
  }

  function isQrVideo(video){
    if(!video || typeof video!=='object') return false;
    const facing=video.facingMode;
    if(typeof facing==='string') return facing==='environment';
    if(facing && typeof facing==='object') {
      return facing.exact==='environment' || facing.ideal==='environment';
    }
    return false;
  }

  // Aplica a câmera configurada somente às chamadas usadas pelo leitor de QR.
  if(media && nativeGetUserMedia){
    media.getUserMedia=(constraints={})=>{
      const chosen=String(prefs.qr_camera_device_id||'');
      if(!chosen || !isQrVideo(constraints.video)) return nativeGetUserMedia(constraints);
      const video={...(typeof constraints.video==='object'?constraints.video:{})};
      delete video.facingMode;
      video.deviceId={exact:chosen};
      return nativeGetUserMedia({...constraints,video}).catch(err=>{
        if(['NotFoundError','OverconstrainedError','DevicesNotFoundError'].includes(err?.name)){
          flash('A câmera QR salva não está disponível. Usando a câmera padrão.',true);
          return nativeGetUserMedia(constraints);
        }
        throw err;
      });
    };
  }

  function applyKeyboard(){
    window.TOTEM_ONSCREEN_KEYBOARD_ENABLED=!!prefs.onscreen_keyboard_enabled;
    window.VirtualKeyboard?.setEnabled?.(!!prefs.onscreen_keyboard_enabled);
    if(!prefs.onscreen_keyboard_enabled) window.VirtualKeyboard?.hide?.();
  }

  async function loadPrefs(){
    try{
      const r=await fetch(endpoint,{cache:'no-store'});
      if(!r.ok)return;
      const data=await r.json();
      prefs.onscreen_keyboard_enabled=data.onscreen_keyboard_enabled!==false;
      prefs.qr_camera_device_id=String(data.qr_camera_device_id||'');
      applyKeyboard();
    }catch(error){
      console.warn('Falha ao carregar preferências do dispositivo:',error);
    }
  }

  async function savePrefs(){
    const r=await fetch(endpoint,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(prefs)
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||`Erro ${r.status}`);
    applyKeyboard();
    return data;
  }

  function addOption(select,label,value,selected=false){
    const option=document.createElement('option');
    option.value=value;
    option.textContent=label;
    option.selected=selected;
    select.appendChild(option);
  }

  async function enumerateCameras(select,{requestPermission=true}={}){
    if(!select)return;
    select.disabled=true;
    select.innerHTML='';
    addOption(select,'Detectando câmeras...','');

    if(!media?.enumerateDevices){
      select.innerHTML='';
      addOption(select,'Enumeração de câmeras não suportada','');
      return;
    }

    let permissionStream=null;
    try{
      // Sem uma permissão concedida, vários navegadores retornam deviceId/label vazios.
      if(requestPermission && nativeGetUserMedia){
        permissionStream=await nativeGetUserMedia({video:true,audio:false});
      }
      const devices=(await media.enumerateDevices()).filter(d=>d.kind==='videoinput');
      select.innerHTML='';
      addOption(select,'Automática / padrão do navegador','',!prefs.qr_camera_device_id);
      devices.forEach((device,index)=>{
        const label=device.label?.trim() || `Câmera ${index+1}`;
        addOption(select,label,device.deviceId,device.deviceId===prefs.qr_camera_device_id);
      });
      if(prefs.qr_camera_device_id && !devices.some(d=>d.deviceId===prefs.qr_camera_device_id)){
        addOption(select,'Câmera salva (não encontrada agora)',prefs.qr_camera_device_id,true);
      }
      if(!devices.length){
        addOption(select,'Nenhuma câmera encontrada','__none__');
      }
      select.disabled=false;
      const status=document.getElementById('qrCameraStatus');
      if(status){
        status.textContent=devices.length
          ? `${devices.length} câmera(s) encontrada(s). A seleção fica salva neste totem.`
          : 'Nenhuma câmera de vídeo foi encontrada pelo navegador.';
      }
    }catch(error){
      select.innerHTML='';
      addOption(select,'Permissão de câmera necessária','__permission__');
      select.disabled=false;
      const status=document.getElementById('qrCameraStatus');
      if(status)status.textContent=`Não foi possível listar câmeras: ${error.name||error.message}`;
    }finally{
      permissionStream?.getTracks?.().forEach(track=>track.stop());
    }
  }

  function settingsCard(){
    return `
      <div class="section-card" id="devicePreferencesCard">
        <h3>Tela, teclado e câmera QR</h3>
        <label class="switch-line">
          <span><strong>Exibir teclado virtual</strong><small style="display:block;color:var(--muted);font-weight:400;margin-top:3px">Desative quando o equipamento já mostrar o teclado nativo em modo tablet.</small></span>
          <input type="checkbox" id="onscreenKeyboardEnabled">
        </label>
        <div class="settings-grid" style="margin-top:16px">
          <div>
            <label class="form-label" for="qrCameraDevice"><strong>Câmera padrão para leitores de QR Code</strong></label>
            <select class="form-select" id="qrCameraDevice"></select>
            <div id="qrCameraStatus" style="font-size:.82rem;color:var(--muted);margin-top:6px">Aguardando detecção...</div>
            <button type="button" class="btn btn-secondary" id="refreshQrCameras" style="margin-top:10px">↻ Detectar câmeras novamente</button>
          </div>
        </div>
      </div>`;
  }

  function injectSettings(){
    const modal=document.querySelector('#modalRoot .modal-card');
    if(!modal || !/Dashboard de configuração/i.test(modal.textContent||''))return;
    if(document.getElementById('devicePreferencesCard'))return;

    const body=modal.querySelector('.modal-body');
    if(!body)return;
    const rules=[...body.querySelectorAll('.section-card')].find(card=>/Regras do fluxo/i.test(card.textContent||''));
    const wrapper=document.createElement('div');
    wrapper.innerHTML=settingsCard().trim();
    const card=wrapper.firstElementChild;
    if(rules)rules.insertAdjacentElement('afterend',card);else body.prepend(card);

    const keyboard=document.getElementById('onscreenKeyboardEnabled');
    const camera=document.getElementById('qrCameraDevice');
    const refresh=document.getElementById('refreshQrCameras');
    keyboard.checked=!!prefs.onscreen_keyboard_enabled;

    keyboard.addEventListener('change',async()=>{
      const previous=prefs.onscreen_keyboard_enabled;
      prefs.onscreen_keyboard_enabled=keyboard.checked;
      applyKeyboard();
      try{
        await savePrefs();
        flash(keyboard.checked?'Teclado virtual ativado.':'Teclado virtual desativado.');
      }catch(error){
        prefs.onscreen_keyboard_enabled=previous;
        keyboard.checked=previous;
        applyKeyboard();
        flash(error.message,true);
      }
    });

    camera.addEventListener('change',async()=>{
      if(camera.value.startsWith('__'))return;
      const previous=prefs.qr_camera_device_id;
      prefs.qr_camera_device_id=camera.value;
      try{
        await savePrefs();
        flash(camera.value?'Câmera padrão de QR salva.':'Seleção automática de câmera ativada.');
      }catch(error){
        prefs.qr_camera_device_id=previous;
        flash(error.message,true);
        await enumerateCameras(camera,{requestPermission:false});
      }
    });

    refresh.addEventListener('click',async()=>{
      refresh.disabled=true;
      refresh.textContent='Detectando...';
      await enumerateCameras(camera,{requestPermission:true});
      refresh.disabled=false;
      refresh.textContent='↻ Detectar câmeras novamente';
    });

    // Detecta automaticamente ao abrir a configuração.
    enumerateCameras(camera,{requestPermission:true});
  }

  async function toggleFullscreen(){
    try{
      if(document.fullscreenElement || document.webkitFullscreenElement){
        if(document.exitFullscreen)await document.exitFullscreen();
        else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
        flash('Modo tela cheia desativado.');
      }else{
        const root=document.documentElement;
        if(root.requestFullscreen)await root.requestFullscreen({navigationUI:'hide'});
        else if(root.webkitRequestFullscreen)root.webkitRequestFullscreen();
        else throw new Error('Tela cheia não é suportada neste navegador.');
        flash('Modo tela cheia ativado.');
      }
    }catch(error){
      flash(error.message||'Não foi possível alterar o modo tela cheia.',true);
    }
  }

  function installGearLongPress(){
    const gear=document.getElementById('settingsBtn');
    if(!gear || gear.dataset.longPressReady==='1')return;
    gear.dataset.longPressReady='1';

    const cancel=()=>{
      clearTimeout(longPressTimer);
      longPressTimer=null;
    };

    gear.addEventListener('pointerdown',()=>{
      longPressTriggered=false;
      cancel();
      longPressTimer=setTimeout(async()=>{
        longPressTriggered=true;
        gear.classList.add('long-press-active');
        navigator.vibrate?.(80);
        await toggleFullscreen();
        setTimeout(()=>gear.classList.remove('long-press-active'),250);
      },3000);
    });
    ['pointerup','pointercancel','pointerleave'].forEach(name=>gear.addEventListener(name,cancel));

    // Evita que o mesmo toque longo abra Configurações depois de alternar fullscreen.
    gear.addEventListener('click',event=>{
      if(!longPressTriggered)return;
      event.preventDefault();
      event.stopImmediatePropagation();
      longPressTriggered=false;
    },true);
  }

  const modalRoot=document.getElementById('modalRoot');
  if(modalRoot){
    new MutationObserver(()=>queueMicrotask(injectSettings)).observe(modalRoot,{childList:true,subtree:true});
  }

  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden)loadPrefs();
  });

  installGearLongPress();
  loadPrefs();
})();
