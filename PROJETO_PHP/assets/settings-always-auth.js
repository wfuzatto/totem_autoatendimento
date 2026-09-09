(()=>{
  const B=window.TOTEM_BASE||'';
  const button=document.getElementById('settingsBtn');
  const modalRoot=document.getElementById('modalRoot');
  if(!button||!modalRoot)return;

  const originalOpen=button.onclick;
  if(typeof originalOpen!=='function')return;

  let opening=false;
  let authenticating=false;

  async function request(action,{method='GET',data=null}={}){
    const options={
      method,
      credentials:'same-origin',
      cache:'no-store',
      headers:{'X-Requested-With':'XMLHttpRequest'}
    };
    if(data!==null){
      options.headers['Content-Type']='application/json';
      options.body=JSON.stringify(data);
    }
    const response=await fetch(`${B}/api.php?action=${encodeURIComponent(action)}`,options);
    const json=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(json.error||`Erro ${response.status}`);
    return json;
  }

  async function forceLogout(){
    try{
      await request('admin_logout',{method:'POST'});
    }catch(error){
      console.error('[TOTEM] admin_logout:',error);
      throw new Error('Não foi possível reiniciar a autenticação administrativa.');
    }
  }

  function showLoginError(message){
    const err=document.getElementById('adminErr');
    if(err)err.textContent=message||'';
  }

  button.onclick=async function(event){
    if(opening)return;
    opening=true;
    try{
      // Toda abertura começa com uma sessão zerada para obrigar nova senha.
      await forceLogout();
      await originalOpen.call(button,event);
      setTimeout(()=>document.getElementById('adminPassword')?.focus(),0);
    }catch(error){
      console.error('[TOTEM] settings open:',error);
      window.alert('Não foi possível abrir as configurações com segurança. Tente novamente.');
    }finally{
      opening=false;
    }
  };

  async function authenticateFromModal(){
    if(authenticating)return;
    const input=document.getElementById('adminPassword');
    if(!input)return;
    const password=input.value;
    if(!password){
      showLoginError('Informe a senha de acesso.');
      input.focus();
      return;
    }

    authenticating=true;
    const loginButton=document.getElementById('adminLogin');
    if(loginButton)loginButton.disabled=true;
    showLoginError('');

    try{
      await request('admin_login',{method:'POST',data:{password}});

      // Confirma que o cookie de sessão foi realmente aceito pelo navegador.
      const me=await request('admin_me');
      if(!me.authenticated)throw new Error('A sessão administrativa não foi criada.');

      // Confirma também o endpoint protegido que o dashboard usa.
      await request('settings_get');

      // O openSettings original agora encontra a sessão autenticada e abre
      // o dashboard sem repetir a tela de senha.
      await originalOpen.call(button);
    }catch(error){
      console.error('[TOTEM] admin login:',error);
      showLoginError(error.message||'Não foi possível entrar nas configurações.');
      if(document.getElementById('adminPassword')){
        input.select?.();
        input.focus();
      }
    }finally{
      authenticating=false;
      const currentButton=document.getElementById('adminLogin');
      if(currentButton)currentButton.disabled=false;
    }
  }

  // Captura o botão antes do handler legado para evitar duas autenticações
  // concorrentes e uma possível perda da sessão durante a troca de modal.
  document.addEventListener('click',event=>{
    const target=event.target.closest?.('#adminLogin');
    if(!target||!modalRoot.contains(target))return;
    event.preventDefault();
    event.stopImmediatePropagation();
    authenticateFromModal();
  },true);

  document.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.target?.id!=='adminPassword')return;
    event.preventDefault();
    event.stopImmediatePropagation();
    authenticateFromModal();
  },true);

  function logoutAfterModalCloses(maxMs=15000){
    const started=Date.now();
    const poll=()=>{
      if(modalRoot.children.length===0){
        forceLogout().catch(()=>{});
        return;
      }
      if(Date.now()-started<maxMs)setTimeout(poll,100);
    };
    setTimeout(poll,100);
  }

  // Sem MutationObserver: logout somente quando o usuário realmente fecha,
  // salva ou encerra a sessão. Isso evita derrubar o cookie na transição
  // login -> dashboard.
  document.addEventListener('click',event=>{
    const close=event.target.closest?.('[data-close-modal]');
    if(close&&modalRoot.contains(close)){
      setTimeout(()=>forceLogout().catch(()=>{}),150);
      return;
    }
    const save=event.target.closest?.('#saveSettings');
    if(save&&modalRoot.contains(save))logoutAfterModalCloses();
  },true);

  window.TotemSettingsAuth={forceLogout};
})();
