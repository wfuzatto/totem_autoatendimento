'use strict';
const crypto = require('crypto');

const gatewayUrl = String(process.env.PAYMENT_GATEWAY_URL || '').replace(/\/$/, '');
const apiKey = String(process.env.PAYMENT_GATEWAY_API_KEY || '');
const timeoutMs = Number(process.env.PAYMENT_GATEWAY_TIMEOUT_MS || 15000);
const merchantId = String(process.env.PAYMENT_MERCHANT_ID || 'totem_hotel');
const terminalId = String(process.env.PAYMENT_TERMINAL_ID || 'totem-hotel-01');

function configured() { return Boolean(gatewayUrl && apiKey); }
function statusOf(value) {
  const status=String(value||'').toUpperCase();
  if(status==='APPROVED')return'approved';
  if(status==='DECLINED')return'declined';
  if(status==='CANCELED'||status==='CANCELLED'||status==='EXPIRED')return'cancelled';
  if(status==='ERROR')return'error';
  return'pending';
}
function methodOf(value){
  const method=String(value||'').toLowerCase();
  if(method==='debit')return'DEBIT';
  if(method==='credit')return'CREDIT';
  if(method==='pix')return'PIX';
  throw Object.assign(new Error('Forma de pagamento invalida.'),{code:'INVALID_PAYMENT_METHOD'});
}
async function request(path,{method='GET',body=null,idempotencyKey=null}={}){
  if(!configured())throw Object.assign(new Error('Gateway central de pagamentos nao configurado.'),{code:'PAYMENT_GATEWAY_NOT_CONFIGURED'});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const headers={accept:'application/json','x-api-key':apiKey,'x-request-id':crypto.randomUUID()};
    if(body!==null)headers['content-type']='application/json';
    if(idempotencyKey)headers['idempotency-key']=idempotencyKey;
    const response=await fetch(`${gatewayUrl}${path}`,{method,headers,body:body===null?undefined:JSON.stringify(body),signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.message||data.error||`Gateway HTTP ${response.status}`),{code:data.error||'PAYMENT_GATEWAY_ERROR',status:response.status});
    return data;
  }catch(error){
    if(error.name==='AbortError')throw Object.assign(new Error('Timeout no gateway central de pagamentos.'),{code:'PAYMENT_GATEWAY_TIMEOUT'});
    throw error;
  }finally{clearTimeout(timer)}
}
async function createPayment({reservation,method,amountCents,localPaymentId}){
  const result=await request('/api/v1/payment-intents',{
    method:'POST',
    idempotencyKey:`totem_hotel:${reservation.id}:${localPaymentId}`,
    body:{
      source_module:'totem_autoatendimento',
      source_reference:String(reservation.reservation_number||reservation.id),
      merchant_id:merchantId,
      method:methodOf(method),
      amount_cents:Number(amountCents),
      currency:'BRL',
      metadata:{reservation_id:reservation.id,reservation_number:reservation.reservation_number,terminal_id:terminalId,channel:'hotel_kiosk'}
    }
  });
  const payment=result.payment||result;
  return{gatewayId:payment.id,status:statusOf(payment.status),gatewayStatus:payment.status,nextAction:payment.next_action||null,provider:payment.provider||null,externalId:payment.external_id||null};
}
async function getPayment(gatewayId){
  const payment=await request(`/api/v1/payment-intents/${encodeURIComponent(gatewayId)}`);
  return{gatewayId:payment.id,status:statusOf(payment.status),gatewayStatus:payment.status,nextAction:payment.next_action||null,provider:payment.provider||null,externalId:payment.external_id||null};
}
module.exports={configured,createPayment,getPayment,statusOf};
