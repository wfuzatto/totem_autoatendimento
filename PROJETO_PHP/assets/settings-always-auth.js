(()=>{
  const B=window.TOTEM_BASE||'';
  const button=document.getElementById('settingsBtn');
  const modalRoot=document.getElementById('modalRoot');
  if(!button) return;

  const originalOpen=button.onclick;
  if(typeof originalOpen!=='function') return;

  let opening=false;

  async function forceLogout(){
    const response=await fetch(`${B}/api.php?action=admin_logout`,{
      method:'POST',
      credentials:'same-origin',
      cache:'no-store',
      headers:{'X-Requested-With':'XMLHttpRequest'}
    });
    if(!response.ok) throw new Error('Não foi possível reiniciar a autenticação administrativa.');
  }

  button.onclick=async function(event){
    if(opening) return;
    opening=true;
    try{
      // Regra do totem: cada abertura das configurações exige nova senha,
      // mesmo que uma sessão PHP anterior ainda esteja válida.
      await forceLogout();
      await originalOpen.call(button,event);
    }catch(error){
      console.error('[TOTEM] Falha ao exigir nova autenticação:',error);
      window.alert('Não foi possível abrir as configurações com segurança. Tente novamente.');
    }finally{
      opening=false;
    }
  };

  // Ao fechar completamente o modal administrativo, encerra também a sessão.
  // O debounce evita logout na transição login -> dashboard.
  if(modalRoot){
    let closeTimer=null;
    const observer=new MutationObserver(()=>{
      clearTimeout(closeTimer);
      if(modalRoot.children.length===0){
        closeTimer=setTimeout(()=>{
          if(modalRoot.children.length===0){
            forceLogout().catch(()=>{});
          }
        },350);
      }
    });
    observer.observe(modalRoot,{childList:true});
  }
})();
