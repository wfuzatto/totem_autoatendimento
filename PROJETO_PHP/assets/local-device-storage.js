(()=>{
  const B=window.TOTEM_BASE||'';
  const endpoint=`${B}/device-settings.php`;
  const STORAGE_KEY='totem.device.preferences.v1';
  const defaults={onscreen_keyboard_enabled:true,qr_camera_device_id:''};
  const nativeFetch=window.fetch.bind(window);

  function read(){
    try{
      const raw=localStorage.getItem(STORAGE_KEY);
      if(!raw)return {...defaults};
      const parsed=JSON.parse(raw)||{};
      return {
        onscreen_keyboard_enabled:parsed.onscreen_keyboard_enabled!==false,
        qr_camera_device_id:String(parsed.qr_camera_device_id||'')
      };
    }catch(_){
      return {...defaults};
    }
  }

  function write(value){
    const next={
      onscreen_keyboard_enabled:value?.onscreen_keyboard_enabled!==false,
      qr_camera_device_id:String(value?.qr_camera_device_id||'')
    };
    localStorage.setItem(STORAGE_KEY,JSON.stringify(next));
    return next;
  }

  function isDeviceSettingsRequest(input){
    try{
      const raw=typeof input==='string'?input:input?.url;
      if(!raw)return false;
      const url=new URL(raw,location.href);
      const target=new URL(endpoint,location.href);
      return url.origin===target.origin && url.pathname===target.pathname;
    }catch(_){
      return false;
    }
  }

  window.fetch=async function(input,init={}){
    if(!isDeviceSettingsRequest(input))return nativeFetch(input,init);

    const method=String(init?.method||'GET').toUpperCase();
    if(method==='GET'){
      return new Response(JSON.stringify(read()),{
        status:200,
        headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
      });
    }

    if(method==='POST'){
      try{
        let payload={};
        if(typeof init?.body==='string' && init.body.trim())payload=JSON.parse(init.body);
        const saved=write(payload);
        return new Response(JSON.stringify({ok:true,...saved,storage:'localStorage'}),{
          status:200,
          headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
        });
      }catch(error){
        return new Response(JSON.stringify({error:error?.message||'Falha ao salvar preferências locais.'}),{
          status:400,
          headers:{'Content-Type':'application/json; charset=utf-8'}
        });
      }
    }

    return new Response(JSON.stringify({error:'Método não permitido.'}),{
      status:405,
      headers:{'Content-Type':'application/json; charset=utf-8'}
    });
  };

  window.TotemLocalDevicePreferences={
    storageKey:STORAGE_KEY,
    read,
    write,
    clear(){localStorage.removeItem(STORAGE_KEY)}
  };
})();
