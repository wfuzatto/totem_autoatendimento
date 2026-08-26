(()=>{
  const B=window.TOTEM_BASE||'';
  const themeEndpoint=`${B}/theme-settings.php`;
  const settingsEndpoint=`${B}/api.php?action=settings_get`;
  const SKINS={
    vale_mantiqueira:{label:'Vale da Mantiqueira',description:'Identidade oficial do Hotel Fazenda Vale da Mantiqueira',swatches:['#006b3c','#73b842','#f6c515']},
    neutral:{label:'Neutro',description:'Tema técnico sem identidade específica de hotel',swatches:['#0d6efd','#4c8dff','#9cc3ff']}
  };
  let activeSkin='vale_mantiqueira';
  let injecting=false;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function normalizeSkin(value){return Object.prototype.hasOwnProperty.call(SKINS,value)?value:'vale_mantiqueira'}

  function applySkin(value){
    activeSkin=normalizeSkin(value);
    document.body.dataset.skin=activeSkin;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.setAttribute('content',activeSkin==='neutral'?'#0d6efd':'#006b3c');
  }

  async function loadTheme(){
    try{
      const r=await fetch(themeEndpoint,{cache:'no-store'});
      if(!r.ok)return;
      const data=await r.json();
      applySkin(data.theme_skin);
    }catch(error){console.warn('Falha ao carregar skin:',error)}
  }

  async function saveTheme(value,status){
    const skin=normalizeSkin(value);
    applySkin(skin);
    if(status){status.textContent='Salvando skin...';status.className='theme-save-status';}
    try{
      const r=await fetch(themeEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme_skin:skin})});
      const data=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(data.error||`Erro ${r.status}`);
      if(status){status.textContent='Skin salva.';status.className='theme-save-status ok';}
    }catch(error){
      if(status){status.textContent=error.message;status.className='theme-save-status error';}
    }
  }

  function skinPreviewHtml(skin,logoUrl){
    const s=SKINS[skin];
    return `<div class="skin-preview-head">${skin==='vale_mantiqueira'&&logoUrl?`<img src="${esc(logoUrl)}" alt="Logomarca atual">`:`<div class="neutral-preview-mark"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M12.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m1.679-4.493-1.335 2.226a.75.75 0 0 1-1.174.144l-.774-.773a.5.5 0 0 1 .708-.708l.547.548 1.17-1.951a.5.5 0 1 1 .858.514"/><path d="M2 1a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6.5a.5.5 0 0 1-1 0V1H3v14h3v-2.5a.5.5 0 0 1 .5-.5H8v4H3a1 1 0 0 1-1-1z"/><path d="M4.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm-6 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm-6 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5z"/></svg></div>`}</div><div class="skin-preview-copy"><strong>${esc(s.label)}</strong><small>${esc(s.description)}</small><div class="skin-swatches">${s.swatches.map(c=>`<span style="--swatch:${c}"></span>`).join('')}</div></div>`;
  }

  function mediaPreview(label,inputId,currentUrl,emptyLabel){
    return `<div class="admin-media-card"><div class="admin-media-label">${esc(label)}</div><div class="admin-media-preview" id="${inputId}Preview">${currentUrl?`<img src="${esc(currentUrl)}" alt="Prévia de ${esc(label)}">`:`<div class="admin-media-empty">${esc(emptyLabel)}</div>`}</div><label class="btn btn-outline-secondary admin-media-button" for="${inputId}">Selecionar imagem</label><input type="file" id="${inputId}" accept="image/jpeg,image/png,image/webp" hidden><small id="${inputId}Name">${currentUrl?'Imagem atual carregada':'Nenhuma imagem enviada'}</small></div>`;
  }

  function bindFilePreview(inputId){
    const input=document.getElementById(inputId);
    const preview=document.getElementById(`${inputId}Preview`);
    const name=document.getElementById(`${inputId}Name`);
    if(!input||!preview)return;
    input.addEventListener('change',()=>{
      const file=input.files?.[0];
      if(!file)return;
      const url=URL.createObjectURL(file);
      preview.innerHTML=`<img src="${url}" alt="Prévia do arquivo selecionado">`;
      if(name)name.textContent=file.name;
      const img=preview.querySelector('img');
      img?.addEventListener('load',()=>setTimeout(()=>URL.revokeObjectURL(url),500),{once:true});
    });
  }

  async function inject(){
    if(injecting)return;
    const modal=document.querySelector('#modalRoot .modal-card');
    if(!modal||!/Dashboard de configuração/i.test(modal.textContent||''))return;
    if(document.getElementById('themeSkinSelect'))return;
    const identity=[...modal.querySelectorAll('.section-card')].find(card=>/Identidade e mensagens/i.test(card.textContent||''));
    if(!identity)return;
    injecting=true;
    try{
      const r=await fetch(settingsEndpoint,{cache:'no-store'});
      if(!r.ok)throw new Error('Não foi possível carregar as imagens atuais.');
      const settings=await r.json();
      const themeR=await fetch(themeEndpoint,{cache:'no-store'});
      if(themeR.ok){const t=await themeR.json();activeSkin=normalizeSkin(t.theme_skin);applySkin(activeSkin)}
      identity.classList.add('v2-identity-restored');
      identity.innerHTML=`<h3>Identidade visual e mensagens</h3><div class="theme-admin-grid"><div><label class="form-label" for="themeSkinSelect">Skin do totem</label><select class="form-select" id="themeSkinSelect"><option value="vale_mantiqueira" ${activeSkin==='vale_mantiqueira'?'selected':''}>Vale da Mantiqueira</option><option value="neutral" ${activeSkin==='neutral'?'selected':''}>Neutro</option></select><p class="theme-help">A skin altera apenas a identidade visual, sem modificar os fluxos de check-in e check-out.</p><div id="themeSaveStatus" class="theme-save-status"></div></div><div class="skin-preview" id="skinPreview">${skinPreviewHtml(activeSkin,settings.logo_url)}</div></div><div class="admin-media-grid">${mediaPreview('Logomarca','upLogo',settings.logo_url,'Sem logomarca')}${mediaPreview('Propaganda final','upAd',settings.advertisement_url,'Sem propaganda')}${mediaPreview('QR gov.br','upGov',settings.govbr_qr_url,'Sem QR gov.br')}</div>`;
      const select=document.getElementById('themeSkinSelect');
      const preview=document.getElementById('skinPreview');
      const status=document.getElementById('themeSaveStatus');
      select?.addEventListener('change',async()=>{
        const skin=normalizeSkin(select.value);
        if(preview)preview.innerHTML=skinPreviewHtml(skin,settings.logo_url);
        await saveTheme(skin,status);
      });
      bindFilePreview('upLogo');bindFilePreview('upAd');bindFilePreview('upGov');
    }catch(error){console.error('[TOTEM] Falha ao restaurar identidade visual:',error)}
    finally{injecting=false}
  }

  const root=document.getElementById('modalRoot');
  if(root)new MutationObserver(()=>queueMicrotask(inject)).observe(root,{childList:true,subtree:true});
  loadTheme();
})();
