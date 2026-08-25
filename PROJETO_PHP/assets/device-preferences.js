(()=>{
  const B=window.TOTEM_BASE||'';
  const endpoint=`${B}/device-settings.php`;
  const prefs={onscreen_keyboard_enabled:true,qr_camera_device_id:''};
  window.TOTEM_ONSCREEN_KEYBOARD_ENABLED=true;

  const media=navigator.mediaDevices;
  const nativeGetUserMedia=media?.getUserMedia ? media.getUserMedia.bind(media) : null;

  function isQrVideo(video){
    if(!video || typeof video!=='object') return false;
    const facing=video.facingMode;
    if(typeof facing==='string') return facing==='environment';
    if(facing && typeof facing==='object') {
      return facing.exact==='environment' || facing.ideal==='environment';
    }
    return false;
  }

  if(media && nativeGetUserMedia){
    media.getUserMedia=(constraints={})=>{
      const chosen=prefs.qr_camera_device_id;
      if(!chosen || !isQrVideo(constraints.video)) return nativeGetUserMedia(constraints);
      const video={...(typeof constraints.video==='object'?constraints.video:{})};
      delete video.facingMode;
      video.deviceId={exact:chosen};
      return nativeGetUserMedia({...constraints,video}).catch(err=>{
        if(['NotFoundError','OverconstrainedError','DevicesNotFoundError'].includes(err?.name)){
          return nativeGetUserMedia(constraints);
        }
        throw err;
      });
    };
  }

  function applyKeyboard(){
    window.TOTEM_ONSCREEN_KEYBOARD_ENABLED=!!prefs.onscreen_keyboard_enabled;
    if(!prefs.onscreen_keyboard_enabled) window.VirtualKeyboard?.hide?.();
    window.VirtualKeyboard?.setEnabled?.(!!prefs.onscreen_keyboard_enabled);
  }

  async function loadPrefs(){
    try{
      const r=await fetch(endpoint,{cache:'no-store'});
      if(!r.ok) return;
      const data=await r.json();
      prefs.onscreen_keyboard_enabled=data.onscreen_keyboard_enabled!==false;
      prefs.qr_camera_device_id=String(data.qr_camera_device_id||'');
      applyKeyboard();
    }catch(_){ }
  }

  async function savePrefs(){
    try{
      const r=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(prefs)
      });
      if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||`Erro ${r.status}`);
      applyKeyboard();
      return true;
    }catch(error){
      console.warn('Não foi possível salvar preferências do dispositivo:',error);
      return false;
    }
  }

  function option(label,value,selected=false){
    const o=document.createElement('option');
    o.value=value;o.textContent=label;o.selected=selected;return o;
  }

  async function listCameras(select,{requestPermission=false}={}){
    if(!select) return;
    const current=prefs.qr_camera_device_id;
    select.innerHTML='';
    select.appendChild(option('Automática / padrão do navegador','',!current));
    if(!media?.enumerateDevices){
      select.appendChild(option('Enumeração de câmeras indisponível','__unsupported__'));
      select.disabled=true;
      return;
    }
    let temp=null;
    try{
      if(requestPermission && nativeGetUserMedia){
        temp=await nativeGetUserMedia({video:true,audio:false});
      }
      const devices=(await media.enumerateDevices()).filter(d=>d.kind==='videoinput');
      devices.forEach((d,i)=>select.appendChild(option(d.label||`Câmera ${i+1}`,d.deviceId,d.deviceId===current)));
      if(current && !devices.some(d=>d.deviceId===current)){
        select.appendChild(option('Câmera salva não encontrada',current,true));
      }
      select.disabled=false;
    }catch(error){
      select.appendChild(option(`Não foi possível listar: ${error.name||'erro'}`,'__error__'));
      select.disabled=false;
    }finally{
      temp?.getTracks?.().forEach(t=>t.stop());
    }
  }

  function findSection(title){
    return [...document.querySelectorAll('#modalRoot .section-card')]
      .find(card=>card.querySelector('h3')?.textContent?.trim()===title);
  }

  function injectSettings(){
    const rules=findSection('Regras do fluxo');
    if(rules && !document.getElementById('onscreenKeyboardEnabled')){
      const row=document.createElement('label');
      row.className='switch-line';
      row.innerHTML='<span>Exibir teclado virtual na tela</span><input type="checkbox" id="onscreenKeyboardEnabled">';
      rules.appendChild(row);
      const input=row.querySelector('input');
      input.checked=!!prefs.onscreen_keyboard_enabled;
      input.addEventListener('change',async()=>{
        prefs.onscreen_keyboard_enabled=input.checked;
        applyKeyboard();
        await savePrefs();
      });
    }

    const hardware=findSection('Hardware');
    if(hardware && !document.getElementById('qrCameraDevice')){
      const grid=hardware.querySelector('.settings-grid')||hardware;
      const box=document.createElement('div');
      box.innerHTML='<label class="form-label" for="qrCameraDevice">Câmera padrão para QR Code</label><select class="form-select" id="qrCameraDevice"></select><button type="button" class="btn btn-secondary" id="refreshQrCameras" style="margin-top:8px">Detectar câmeras</button><div style="font-size:.82rem;color:var(--muted);margin-top:6px">A câmera selecionada será usada primeiro nos leitores de QR Code. Se ela não estiver disponível, o sistema usa a câmera padrão.</div>';
      grid.appendChild(box);
      const select=box.querySelector('#qrCameraDevice');
      const refresh=box.querySelector('#refreshQrCameras');
      listCameras(select);
      select.addEventListener('change',async()=>{
        if(select.value.startsWith('__')) return;
        prefs.qr_camera_device_id=select.value;
        await savePrefs();
      });
      refresh.addEventListener('click',async()=>{
        refresh.disabled=true;
        refresh.textContent='Detectando...';
        await listCameras(select,{requestPermission:true});
        refresh.disabled=false;
        refresh.textContent='Detectar câmeras';
      });
    }
  }

  const observer=new MutationObserver(()=>queueMicrotask(injectSettings));
  const root=document.getElementById('modalRoot');
  if(root) observer.observe(root,{childList:true,subtree:true});

  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden) loadPrefs().then(injectSettings);
  });

  loadPrefs().then(injectSettings);
})();
