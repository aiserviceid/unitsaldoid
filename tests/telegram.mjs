import {createHmac} from 'node:crypto';
// Node 24+: native TypeScript stripping; SUPABASE_SDK_MODULE points to supabase-js 2.57.4.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
const root=new URL('../',import.meta.url);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'unitsaldo-bot-test-'));
import {fileURLToPath} from 'node:url';
const localSupabase = fileURLToPath(new URL('../node_modules/@supabase/supabase-js', import.meta.url)).replace(/\\/g, '/');
const src=fs.readFileSync(new URL('supabase/functions/telegram-webhook/index.ts',root),'utf8').replace("import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';", `import {createRequire} from 'node:module'; const {createClient}=createRequire(import.meta.url)(process.env.SUPABASE_SDK_MODULE || '${localSupabase}');`);
fs.writeFileSync(dir+'/index.ts',src);fs.copyFileSync(new URL('supabase/functions/telegram-webhook/core.ts',root),dir+'/core.ts');
fs.copyFileSync(new URL('supabase/functions/telegram-webhook/finance.ts',root),dir+'/finance.ts');
const {nominal,parseSimple,validateParsed,walletBalance,readIntent,canViewFinances,parseObligation,resolveDueDate,parsePayment,validateAiFinancialRewrite}=await import(pathToFileURL(dir+'/core.ts'));
assert.equal(nominal('1,5jt'),1500000);assert.equal(nominal('1.500.000'),1500000);assert.equal(nominal('75rb'),75000);assert.equal(nominal('1.234,56'),0);assert.equal(nominal('0'),0);
const wallets=[{id:'cash',name:'Tunai'},{id:'bca',name:'BCA'},{id:'dana',name:'DANA'}];
assert.equal(parseSimple('beli beras 75rb pakai tunai',wallets).kind,'expense');
assert.equal(parseSimple('terima gaji 3jt ke BCA',wallets).amount,3000000);
assert.equal(parseSimple('masuk 1 juta tunai',wallets).kind,'income');assert.equal(parseSimple('masuk 1 juta tunai',wallets).amount,1000000);assert.equal(parseSimple('uang masuk 1juta dari usaha',[wallets[0]]).kind,'income');assert.match(parseSimple('uang masuk 1juta dari usaha',wallets).clarification,/dompet mana/);assert.equal(parseSimple('keluar 20rb tunai',wallets).kind,'expense');
const yudiWallets=[{id:'yudi-cash',name:'Tunai / Cash'},{id:'yudi-bank',name:'Rekening Bank'}];
for(const alias of ['tunai','cash','Tunai / Cash']){const parsed=parseSimple('masuk 25juta '+alias,yudiWallets);assert.equal(parsed.kind,'income');assert.equal(parsed.amount,25000000);assert.equal(parsed.wallet_id,'yudi-cash');assert.equal(validateParsed(parsed,yudiWallets,[]),null);}
assert.equal(parseSimple('keluar 50rb cash',yudiWallets).wallet_id,'yudi-cash');
assert.equal(parseSimple('transfer 100rb dari cash ke Rekening Bank',yudiWallets).destination_wallet_id,'yudi-bank');
assert.equal(parseObligation('piutang Andi 500rb dari tunai bayar tanggal 10 bulan depan',yudiWallets).wallet_id,'yudi-cash');
assert.equal(parsePayment('Andi bayar hutang 200rb cash',yudiWallets).wallet_id,'yudi-cash');
assert.equal(parseSimple('masuk 25juta tunainya',yudiWallets).intent,'unknown');
assert.equal(parseSimple('masuk 25juta cash',[...yudiWallets,{id:'second-cash',name:'Cash | Kas toko'}]).intent,'unknown');
assert.equal(parsePayment('Andi bayar hutang 200rb cash dan transfer lain',yudiWallets).intent,'unknown');
for(const verb of ['bayar','cicil','melunasi']){
 const p=parseSimple('IPUD '+verb+' 1 juta tunai',yudiWallets);
 assert.equal(p.intent,'payment');assert.equal(p.kind,'receivable_payment');assert.equal(p.contact_name,'IPUD');assert.equal(p.amount,1000000);assert.equal(p.wallet_id,'yudi-cash');
}
assert.match(parseSimple('Ipud bayar 1 juta',yudiWallets).clarification,/Uang masuk ke.*dompet mana/);
assert.match(parseSimple('Ipud bayar',yudiWallets).clarification,/nominal/);
assert.equal(parseSimple('saya bayar 1juta tunai',yudiWallets).kind,'expense');
assert.equal(parseSimple('bayar listrik 100rb tunai',yudiWallets).kind,'expense');
assert.equal(parseSimple('Ipud belum bayar 1juta tunai',yudiWallets).intent,'unknown');
console.log('PASS: Yudi cash aliases recognize 25juta, expense, transfer, obligation and payment; word boundaries and ambiguous names remain safe.');
assert.equal(parseSimple('transfer 100rb dari BCA ke DANA',wallets).destination_wallet_id,'dana');
assert.equal(parseSimple('belum bayar bensin 25rb tunai',wallets),null);
assert.match(parseSimple('beli beras 75rb',wallets).clarification,/dompet mana/);
assert.equal(parseSimple('beli 2 beras 75rb tunai',wallets),null);
assert.equal(readIntent('cek saldo'), 'balance');assert.equal(readIntent('cek piutang'), 'receivable');
assert.ok(validateParsed({intent:'transaction',kind:'expense',amount:10,description:'X',wallet_id:'foreign'},wallets,[]));
assert.equal(walletBalance('bca',[{wallet_id:'bca',kind:'debt_disbursement',amount:100},{wallet_id:'bca',kind:'transfer',amount:20,destination_wallet_id:'dana'}]),80);
const piutang=parseObligation('piutang Nuno 500rb dari Tunai bayar tanggal 10 bulan depan',wallets,new Date('2026-10-02T19:26:00Z'));
assert.equal(piutang.obligation_type,'receivable');assert.equal(piutang.kind,'receivable_disbursement');assert.equal(piutang.contact_name,'Nuno');assert.equal(piutang.amount,500000);assert.equal(piutang.due_date,'2026-11-10');assert.equal(piutang.due_note,'tanggal 10 bulan depan');
assert.equal(parseObligation('saya utang ke Nuno 500rb masuk Tunai jatuh tempo 2026-11-03',wallets).due_date,'2026-11-03');
assert.equal(parseObligation('Nuno utang ke saya 500rb dari Tunai',wallets).obligation_type,'receivable');
assert.match(parseObligation('nuno utang 500rb bayar bulan depan',wallets).clarification,/tanggal berapa/);
assert.match(parseObligation('piutang Nuno 500rb',wallets).clarification,/dompet/i);
assert.equal(parseObligation('piutang Nuno -500rb dari Tunai',wallets).intent,'unknown');
assert.equal(parseObligation('piutang Nuno 500rb dari Tunai jatuh tempo 2026-02-30',wallets).intent,'unknown');
assert.equal(parseObligation('belum piutang Nuno 500rb dari Tunai',wallets).intent,'unknown');
const oct=new Date('2026-10-02T19:26:00Z');
assert.equal(resolveDueDate('tanggal 10 bulan depan',oct).date,'2026-11-10');
assert.equal(resolveDueDate('akhir bulan depan',oct).date,'2026-11-30');
assert.equal(resolveDueDate('tgl 10 bulan ini',oct).date,'2026-10-10');
assert.equal(resolveDueDate('besok',oct).date,'2026-10-04');
assert.equal(resolveDueDate('8 hari lagi',oct).date,'2026-10-11');
assert.equal(resolveDueDate('2 minggu lagi',oct).date,'2026-10-17');
assert.equal(resolveDueDate('10/11/2026',oct).date,'2026-11-10');
assert.match(resolveDueDate('bulan depan',oct).clarification,/November 2026/);
assert.equal(resolveDueDate('tanggal 31 bulan depan',oct).date,null);
assert.equal(resolveDueDate('tanggal 10 bulan depan',new Date('2026-12-31T16:00:00Z')).date,'2027-01-10');
assert.equal(resolveDueDate('tanggal 10 bulan depan',new Date('2026-12-31T18:00:00Z')).date,'2027-02-10');
assert.equal(resolveDueDate('akhir bulan depan',new Date('2028-01-15T05:00:00Z')).date,'2028-02-29');
assert.equal(parsePayment('nuno bayar hutang 200k Tunai',wallets).kind,'receivable_payment');
assert.equal(parsePayment('bayar utang Nuno 200rb Tunai',wallets).kind,'debt_payment');
assert.equal(parsePayment('terima piutang dari Nuno 200rb Tunai',wallets).kind,'receivable_payment');
assert.match(parsePayment('nuno bayar hutang 200k',wallets).clarification,/Uang masuk ke dompet mana/);
assert.equal(parsePayment('Nuno belum bayar hutang 200rb Tunai',wallets).intent,'unknown');
assert.equal(parsePayment('Nuno bayar hutang 200rb Tunai dan 100rb BCA',wallets).intent,'unknown');
assert.equal(parsePayment('Nuno bayar hutang 200rb BCA1',[{id:'bca1',name:'BCA1'}]).wallet_id,'bca1');
const financeNow=new Date('2026-10-03T01:28:00Z');
for(const text of ['nuno pinjam saya tunai 500k','nuno piutang 500k tunai','nuno piutang dari tunai 500k','piutang nuno tunai 500k','nuno utang 500k tunai','nuno piutng tnai 500k','nuno pnjam saya 500k tunai']){
 const p=parseSimple(text,wallets,financeNow);assert.equal(p.intent,'obligation',text);assert.equal(p.kind,'receivable_disbursement',text);assert.equal(p.amount,500000,text);assert.equal(p.contact_name,'nuno',text);assert.equal(p.wallet_id,'cash',text);
}
for(const text of ['saya pinjam nuno tunai 500k','saya utang nuno 500k tunai','pinjam dari nuno 500k tunai'])assert.equal(parseSimple(text,wallets,financeNow).kind,'debt_disbursement',text);
assert.equal(parseSimple('nuno byr tunai 200k',wallets).kind,'receivable_payment');
assert.equal(parseSimple('bayar utang nuno tunai 200k',wallets).kind,'debt_payment');
assert.equal(parseSimple('piutang BCA 500k Tunai',wallets).contact_name,'BCA');
assert.equal(parseSimple('piutang Nuno 500k Tunai dan 200k BCA',wallets).intent,'unknown');
const originalFinance='aku kasih pinjaman ke Nuno tunai 500k';
assert.equal(validateAiFinancialRewrite(originalFinance,'piutang Nuno 500k Tunai',wallets,financeNow).kind,'receivable_disbursement');
for(const cmd of ['piutang Andi 500k Tunai','piutang Nuno 600k Tunai','piutang Nuno 500k BCA','piutang Nuno 500k Tunai bayar besok'])assert.equal(validateAiFinancialRewrite(originalFinance,cmd,wallets,financeNow),null,cmd);
assert.equal(validateAiFinancialRewrite('belum kasih pinjaman ke Nuno 500k Tunai','piutang Nuno 500k Tunai',wallets,financeNow),null);
assert.equal(validateAiFinancialRewrite('kasih pinjaman ke Nuno Tunai','piutang Nuno 500k Tunai',wallets,financeNow),null);
console.log('PASS: user examples, wallet-before-amount, short debt directions, common typos, payment shorthand, no invented names/amount/wallet/due dates from AI.');
const settings={SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-key',TELEGRAM_BOT_TOKEN:'test-token',TELEGRAM_WEBHOOK_SECRET:'s'.repeat(32),GEMINI_API_KEY:'gemini-test'};
globalThis.Deno={env:{get:k=>settings[k]},serve:()=>{}};
const configStore={};let adminUser=true;let reminderAvailable=true,reminderEligible=true;const reminderStates=[];let phonePasswordUpdates=0;
const cancellationCalls=[];let cancelDone=false;const callbackAnswers=[],sent=[],links=new Map([['124',{owner_id:'owner',telegram_position:2}],['125',{owner_id:'owner',telegram_position:2}]]),drafts=[];
let profileStatus='trial',recapTxs=[],geminiMode='valid',geminiCalls=0,txCount=0,privateReads=0,lookupRows=[];
assert.equal(canViewFinances({}),false);assert.equal(canViewFinances({telegram_position:3}),false);assert.equal(canViewFinances({telegram_position:1}),true);
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})}
globalThis.fetch=async(url,opts={})=>{
 url=String(url);const u=new URL(url),body=opts.body?JSON.parse(opts.body):null;
 if(u.hostname==='api.telegram.org'){
  if(u.pathname.includes('/file/bot'))return new Response(Buffer.from('/9j/AA==','base64'),{status:200,headers:{'Content-Type':'image/jpeg'}});
  const method=u.pathname.split('/').at(-1);if(method==='sendMessage')sent.push(body);if(method==='answerCallbackQuery')callbackAnswers.push(body);
  if(method==='getMe')return json({ok:true,result:{username:'unitsaldobot'}});
  if(method==='getWebhookInfo')return json({ok:true,result:{url:settings.SUPABASE_URL+'/functions/v1/telegram-webhook',pending_update_count:0}});
  if(method==='getFile')return json({ok:true,result:{file_id:body.file_id,file_path:'photos/test.jpg'}});
  return json({ok:true,result:true});
 }
 if(u.hostname==='generativelanguage.googleapis.com'){
  geminiCalls++;assert.ok(u.pathname.includes('/gemini-3.1-flash-lite:generateContent'));assert.equal(new Headers(opts.headers).get('x-goog-api-key'),'gemini-test');assert.ok(!url.includes('gemini-test'));
  assert.ok(!JSON.stringify(body).includes('subscription_status'));if(geminiMode==='rate')return json({error:'quota'},429);if(geminiMode==='narrative')return json({candidates:[{content:{parts:[{text:'Pendapatan tercatat lebih besar daripada pengeluaran operasional. Arus kas juga dipengaruhi penerimaan utang.'}]}}]});
  if(geminiMode==='receipt'||geminiMode==='receiptUnclear'){assert.equal(body.contents[0].parts[1].inlineData.mimeType,'image/jpeg');assert.ok(body.contents[0].parts[1].inlineData.data.startsWith('/9j/'));return json({candidates:[{content:{parts:[{text:JSON.stringify({merchant:'Toko <img>',total:geminiMode==='receipt'?125000:0,receipt_date:'2026-10-02',confidence:geminiMode==='receipt'?'clear':'unclear',notes:'Total setelah pajak',items:[{name:'Beras',total:125000}]})}]}}]});}
  if(geminiMode==='report')return json({candidates:[{content:{parts:[{text:JSON.stringify({intent:'report'})}]}}]});
  if(geminiMode==='chat')return json({candidates:[{content:{parts:[{text:JSON.stringify({intent:'chat',kind:'unknown',amount:0,description:'',wallet_id:'',destination_wallet_id:'',category_id:'',clarification:'',reply:'Halo! Ada yang bisa saya bantu catat hari ini?'})}]}}]});
  if(['finance','financeWrongAmount','financeExpense'].includes(geminiMode)){
   assert.ok(body.systemInstruction.parts[0].text.includes('normalized_command'));
   const parsed=geminiMode==='financeExpense'?{intent:'transaction',kind:'expense',amount:500000,description:'Nuno pinjam',wallet_id:'cash'}:{intent:'unknown',kind:'unknown',amount:0,description:'',wallet_id:'',destination_wallet_id:'',category_id:'',clarification:'',normalized_command:'piutang Nuno '+(geminiMode==='financeWrongAmount'?'600k':'500k')+' Tunai'};
   return json({candidates:[{content:{parts:[{text:JSON.stringify(parsed)}]}}]});
  }
  const parsed=geminiMode==='foreign'?{intent:'transaction',kind:'expense',amount:100,description:'X',wallet_id:'foreign'}:{intent:'transaction',kind:'expense',amount:75000,description:'Belanja beras',wallet_id:'cash',category_id:'',destination_wallet_id:'',clarification:''};
  return json({candidates:[{content:{parts:[{text:JSON.stringify(parsed)}]}}]});
 }
 if(u.pathname==='/auth/v1/admin/users/00000000-0000-4000-8000-000000000088'){if(opts.method==='PUT'){assert.ok(body.password.length>=12);phonePasswordUpdates++;}return json({user:{id:'00000000-0000-4000-8000-000000000088',phone:'6285382000666'}});}
 if(u.pathname==='/auth/v1/user')return json({id:'owner',email:adminUser?'ai.interiorid@gmail.com':'client@example.com',email_confirmed_at:new Date().toISOString()});
 const table=u.pathname.split('/').at(-1),single=new Headers(opts.headers).get('accept')?.includes('vnd.pgrst.object');
 let rows=[];
 if(u.pathname.includes('/rpc/')){
  if(table==='cancel_saved_transaction'){cancellationCalls.push({body,authorization:new Headers(opts.headers).get('authorization')});if(body.p_confirm){cancelDone=true;return json({success:true,cancelled:true,message:'Transaksi dibatalkan. Saldo dan tagihan disinkronkan.'});}return json(cancelDone?{success:true,already_cancelled:true,message:'Sudah dibatalkan'}:{success:true,transaction_id:body.p_transaction_id,description:'Beras',amount:125000,wallet:'Tunai',kind:'expense'});}
  if(table==='bot_claim_due_reminders'){const tasks=reminderAvailable?[{id:'00000000-0000-4000-8000-000000000010'}]:[];reminderAvailable=false;return json(tasks);}
  if(table==='bot_reminder_payload')return json(reminderEligible?{chat_id:'124',date:'2026-10-03',tags:[{name:'Nuno',type:'debt',due_date:'2026-10-03',remaining:400000}]}:null);
  if(table==='bot_finish_reminder'){reminderStates.push(body.p_status);return json(true);}
  if(table==='bot_config_read')return json(configStore);
  if(table==='bot_config_save'){Object.assign(configStore,body.p_values);return json(true);}
  if(table==='link_telegram_by_code'){links.set(body.p_chat_id,{owner_id:'owner',telegram_position:2});return json({success:true});}
  if(table==='bot_take_ai_slot')return json(true);
  if(table==='bot_confirm_draft'){const d=drafts.find(d=>d.id===body.p_draft_id&&d.chat_id===body.p_chat_id);if(!d)return json({success:false});if(d.status==='saved')return json({success:true,already_saved:true});if(body.p_cancel){d.status='cancelled';return json({success:true,cancelled:true});}d.status='saved';txCount++;return json({success:true});}
 }
 if(['transactions','obligations'].includes(table))privateReads++;
 if(table==='transactions'){assert.equal(u.searchParams.get('owner_id'),'eq.owner');rows=recapTxs;}
 if(table==='obligations'){assert.equal(u.searchParams.get('owner_id'),'eq.owner');rows=lookupRows;}
 if(table==='profiles')rows=u.searchParams.get('id')==='eq.00000000-0000-4000-8000-000000000088'?[{phone_number:'6285382000666',is_special:true}]:[{is_admin:adminUser,subscription_status:profileStatus,expires_at:null}];
 if(table==='telegram_links'){const id=u.searchParams.get('chat_id')?.slice(3);rows=links.has(id)?[links.get(id)]:[];}
 if(table==='wallets')rows=u.searchParams.get('id')?wallets.filter(w=>w.id===u.searchParams.get('id').slice(3)):wallets;
 if(table==='telegram_drafts'){
  if(opts.method==='POST'){const d={...body,id:'00000000-0000-4000-8000-'+String(drafts.length+1).padStart(12,'0'),status:'pending',expires_at:new Date(Date.now()+900000).toISOString()};drafts.push(d);rows=[d];}
  else if(opts.method==='PATCH'||opts.method==='PUT'){const target=drafts.find(d=>d.id===u.searchParams.get('id')?.slice(3));if(target){Object.assign(target,body);rows=[target];}}
  else rows=drafts.filter(d=>d.chat_id===u.searchParams.get('chat_id')?.slice(3)&&(u.searchParams.get('id')?d.id===u.searchParams.get('id').slice(3):String(d.message_id)===u.searchParams.get('message_id')?.slice(3)));
 }
 return json(single?rows[0]:rows);
};
const {handler}=await import(pathToFileURL(dir+'/index.ts'));
let messageId=1;
async function message(chat,text){return handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook',{method:'POST',headers:{'Content-Type':'application/json','x-telegram-bot-api-secret-token':settings.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify({message:{message_id:messageId++,text,chat:{id:+chat,type:'private'},date:1790969160,from:{id:+chat,first_name:'Istri_*'}}})}));}
assert.equal((await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook',{method:'POST',body:'{}'}))).status,401);
assert.equal((await message('123','/start')).status,200);assert.match(sent.at(-1).text,/Selamat datang/);assert.equal(sent.at(-1).parse_mode,undefined);
await message('123','/start UTS-TEST');assert.match(sent.at(-1).text,/Berhasil terhubung/);assert.equal(links.get('123').owner_id,links.get('124').owner_id);
await message('124','beli beras 75rb tunai');assert.equal(drafts.length,1);assert.equal(drafts[0].payload.recorder_name,'Istri_*');assert.equal(geminiCalls,0);assert.match(sent.at(-1).text,/Belum masuk pembukuan/);
const callback={callback_query:{id:'cb',from:{id:124},data:'save:'+drafts[0].id,message:{chat:{id:124,type:'private'}}}};
const cbRequest=()=>new Request('https://test.supabase.co/functions/v1/telegram-webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':settings.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(callback)});
await handler(cbRequest());await handler(cbRequest());assert.equal(txCount,1);
await message('125','tadi ambil uang tujuh puluh lima ribu untuk beras dari tunai');assert.equal(geminiCalls,0);assert.equal(drafts.length,2);
geminiMode='foreign';await message('125','catat pengeluaran seratus rupiah');assert.equal(drafts.length,2);assert.match(sent.at(-1).text,/Dompet belum jelas/);
geminiMode='rate';await message('125','catat pengeluaran seratus rupiah');assert.equal(drafts.length,2);assert.match(sent.at(-1).text,/dibatasi/);
await message('125','bayar hutang Andi 100rb tunai');assert.match(sent.at(-1).text,/Tidak ada utang aktif/);
await message('124','/saldo');assert.match(sent.at(-1).text,/Saldo keluarga/);
await message('124','masuk 1 juta tunai');assert.equal(drafts.at(-1).payload.kind,'income');assert.equal(drafts.at(-1).payload.amount,1000000);await message('124','uang masuk 1juta dari usaha');assert.match(sent.at(-1).text,/dompet mana/);
links.set('125',{owner_id:'owner',telegram_position:3});
const readsBefore=privateReads;
for(const command of ['/saldo','cek saldo','/utang','/piutang','/laporan','/analisis']){await message('125',command);assert.match(sent.at(-1).text,/hanya memiliki akses transaksi/);}
geminiMode='report';await message('125','tolong rangkum kondisi keuangan keluarga');assert.match(sent.at(-1).text,/hanya memiliki akses transaksi/);assert.equal(privateReads,readsBefore);
await message('125','/bantuan');assert.match(sent.at(-1).text,/akses transaksi saja/);assert.ok(!sent.at(-1).text.includes('/saldo'));
await message('125','keluar 20rb tunai');assert.equal(drafts.at(-1).chat_id,'125');assert.equal(drafts.at(-1).payload.amount,20000);
for(const position of [1,2]){links.set('124',{owner_id:'owner',telegram_position:position});await message('124','/saldo');assert.match(sent.at(-1).text,/Saldo keluarga/);}
await message('125','piutang Nuno 500rb dari Tunai bayar tanggal 10 bulan depan');assert.equal(drafts.at(-1).payload.intent,'obligation');assert.equal(drafts.at(-1).payload.contact_name,'Nuno');assert.equal(drafts.at(-1).payload.recorder_name,'Istri_*');assert.match(sent.at(-1).text,/Beri piutang — uang keluar/);assert.match(sent.at(-1).text,/Pencatat: Istri_/);assert.equal(drafts.at(-1).payload.due_date,'2026-11-10');assert.ok(!sent.at(-1).text.includes('tanggal belum ditentukan'));
await message('124','saya utang ke Nuno 500rb masuk Tunai');assert.equal(drafts.at(-1).payload.kind,'debt_disbursement');assert.match(sent.at(-1).text,/Terima utang — uang masuk/);
await message('124','nuno utang 500rb bayar bulan depan');assert.match(sent.at(-1).text,/tanggal berapa/);
console.log('PASS: Telegram debt direction/wallet/date clarification, atomic draft payload, trusted recorder snapshot, transaction-only member can create obligation without reading balances.');
console.log('PASS: first/second read finances; third direct/AI reports denied without reading ledger; third transaction allowed; missing permission fails closed.');
lookupRows=[{id:'receivable-nuno',contact_name:'Nuno'}];
await message('124','Nuno bayar hutang 200k Tunai');assert.equal(drafts.at(-1).payload.intent,'payment');assert.equal(drafts.at(-1).payload.kind,'receivable_payment');assert.equal(drafts.at(-1).payload.obligation_id,'receivable-nuno');assert.match(sent.at(-1).text,/Terima pembayaran piutang — uang masuk/);
await message('124','bayar utang Nuno 200rb Tunai');assert.equal(drafts.at(-1).payload.kind,'debt_payment');
await message('124','Nuno bayar hutang 200k');assert.match(sent.at(-1).text,/dompet mana/);assert.ok(!sent.at(-1).text.includes('AI sedang dibatasi'));
lookupRows=[{id:'1',contact_name:'Nuno'},{id:'2',contact_name:'Nuno'}];const draftCount=drafts.length;await message('124','Nuno bayar hutang 200k Tunai');assert.equal(drafts.length,draftCount);assert.match(sent.at(-1).text,/beberapa tagihan/);
lookupRows=[];await message('125','Nuno bayar hutang 200k Tunai');assert.match(sent.at(-1).text,/Minta pemilik akun/);
console.log('PASS: payment direction, wallet clarification, exact owner/name lookup, ambiguous/no match cannot draft, private member gets no tagihan details.');
settings.TELEGRAM_BOT_TOKEN='';const admin=await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook/admin',{method:'POST',headers:{Authorization:'Bearer admin-test',Origin:'https://unitsaldoid.vercel.app'},body:JSON.stringify({action:'status'})}));assert.ok((await admin.json()).missing.includes('TELEGRAM_BOT_TOKEN'));
assert.equal((await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook/admin',{method:'POST',body:'{}'}))).status,401);
settings.TELEGRAM_BOT_TOKEN='test-token';adminUser=false;
const clientDenied=await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook/admin',{method:'POST',headers:{Authorization:'Bearer client-test'},body:JSON.stringify({action:'save',values:{TELEGRAM_BOT_TOKEN:'123456:abcdefghijklmnopqrstuvwxyz1234'}})}));assert.equal(clientDenied.status,403);assert.deepEqual(configStore,{});
adminUser=true;
const savedConfig=await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook/admin',{method:'POST',headers:{Authorization:'Bearer admin-test'},body:JSON.stringify({action:'save',values:{TELEGRAM_BOT_TOKEN:'123456:abcdefghijklmnopqrstuvwxyz1234',GEMINI_API_KEY:'gemini-fixture-key-123456'}})}));
const returned=await savedConfig.json();assert.equal(returned.ready,true);assert.equal(returned.gemini_ready,true);assert.ok(!JSON.stringify(returned).includes('gemini-fixture'));assert.equal(configStore.GEMINI_API_KEY,'gemini-fixture-key-123456');
assert.equal(configStore.TELEGRAM_WEBHOOK_SECRET,undefined); // Existing environment secret is preserved.
console.log('PASS: sole verified admin, client config save denied, Vault config RPC, no secret in response, env fallback.');
console.log('PASS: parser rupiah, ambiguity/negation, balance, actual SDK webhook replies, family mapping, plain-text safety, draft confirmation, duplicate callback, Gemini valid/foreign/quota, no AI ledger exposure, missing secrets, admin auth.');

const reminderParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const reminderDate=['year','month','day'].map(k=>reminderParts.find(p=>p.type===k).value).join('-');
const reminderSignature=createHmac('sha256',settings.TELEGRAM_WEBHOOK_SECRET).update('unitsaldo-reminders:'+reminderDate).digest('hex');
const reminderRequest=(secret=reminderSignature)=>new Request('https://test.supabase.co/functions/v1/telegram-webhook/reminders',{method:'POST',headers:{'x-unitsaldo-reminder-auth':secret},body:'{}'});
assert.equal((await handler(reminderRequest('wrong'))).status,401);assert.equal(reminderAvailable,true);
const reminderSentBefore=sent.length;const reminderResponse=await handler(reminderRequest());assert.equal((await reminderResponse.json()).sent,1);assert.equal(sent.length,reminderSentBefore+1);assert.equal(sent.at(-1).chat_id,'124');assert.match(sent.at(-1).text,/Nuno/);assert.match(sent.at(-1).text,/400.000/);assert.equal(reminderStates.at(-1),'sent');
await handler(reminderRequest());assert.equal(sent.length,reminderSentBefore+1);
reminderAvailable=true;reminderEligible=false;const revokedReminder=await handler(reminderRequest());assert.equal((await revokedReminder.json()).skipped,1);assert.equal(sent.length,reminderSentBefore+1);assert.equal(reminderStates.at(-1),'skipped');
console.log('PASS: scheduled reminder endpoint authenticates, sends actual SDK mock Telegram message to permitted chat, finishes sent, duplicate claim sends nothing, revoked eligibility skips delivery.');

const setPhonePassword=()=>new Request('https://test.supabase.co/functions/v1/telegram-webhook/admin',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify({action:'set_phone_password',user_id:'00000000-0000-4000-8000-000000000088',password:'fixture-password-strong'})});
adminUser=false;assert.equal((await handler(setPhonePassword())).status,403);assert.equal(phonePasswordUpdates,0);adminUser=true;const phonePasswordResponse=await handler(setPhonePassword());assert.equal(phonePasswordResponse.status,200);assert.equal((await phonePasswordResponse.json()).success,true);assert.equal(phonePasswordUpdates,1);console.log('PASS: only verified super admin can set genuine phone account password; normal clients denied.');

wallets[0].name='Tunai / Cash';
const aliasAiCalls=geminiCalls;
await message('124','masuk 25juta tunai');
assert.equal(drafts.at(-1).payload.kind,'income');
assert.equal(drafts.at(-1).payload.amount,25000000);
assert.equal(drafts.at(-1).payload.wallet_id,wallets[0].id);
assert.equal(geminiCalls,aliasAiCalls);
assert.match(sent.at(-1).text,/25\.000\.000/);
assert.match(sent.at(-1).text,/Tunai \/ Cash/);
assert.match(sent.at(-1).text,/Belum masuk pembukuan/);
wallets[0].name='Tunai';
console.log('PASS: exact Yudi message masuk 25juta tunai drafts income 25000000 to Tunai / Cash without AI clarification.');

lookupRows=[{id:'ipud-obligation',contact_name:'Ipud'}];
const namedPaymentAiCalls=geminiCalls;
await message('124','Ipud bayar 1juta tunai');
assert.equal(drafts.at(-1).payload.kind,'receivable_payment');
assert.equal(drafts.at(-1).payload.obligation_id,'ipud-obligation');
assert.equal(drafts.at(-1).payload.amount,1000000);
assert.equal(geminiCalls,namedPaymentAiCalls);
assert.match(sent.at(-1).text,/Terima pembayaran piutang — uang masuk/);
const namedPaymentDrafts=drafts.length;
await message('124','Ipud bayar');assert.equal(drafts.length,namedPaymentDrafts);assert.equal(geminiCalls,namedPaymentAiCalls);assert.match(sent.at(-1).text,/nominal/);
lookupRows=[];await message('124','Ipud bayar 1juta tunai');assert.equal(drafts.length,namedPaymentDrafts);assert.match(sent.at(-1).text,/Tidak ada piutang aktif/);
console.log('PASS: named payment without debt keyword links receivable; incomplete or unmatched name cannot become ordinary expense or hallucinated AI draft.');

for(const text of ['nuno pinjam saya tunai 500k','nuno piutang 500k tunai','nuno piutang dari tunai 500k']){
 const before=drafts.length;await message('124',text);assert.equal(drafts.length,before+1);assert.equal(drafts.at(-1).payload.kind,'receivable_disbursement');assert.equal(drafts.at(-1).payload.amount,500000);assert.equal(drafts.at(-1).payload.description,text);
}
const beforeClarification=drafts.length;const beforeClarificationAi=geminiCalls;
await message('124','nuno bayar hutang 200k');assert.equal(drafts.length,beforeClarification);assert.equal(geminiCalls,beforeClarificationAi);
assert.match(sent.at(-1).text,/Uang masuk ke dompet mana/);
const buttons=sent.at(-1).reply_markup.inline_keyboard.flat();assert.equal(buttons[0].copy_text.text,'nuno bayar 200000 Tunai');assert.equal(buttons.at(-1).callback_data,'examples');
const popupRequest=new Request('https://test.supabase.co/functions/v1/telegram-webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':settings.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify({callback_query:{id:'popup',data:'examples',from:{id:124},message:{chat:{id:124,type:'private'}}}})});
const beforePopupTx=txCount;await handler(popupRequest);assert.equal(callbackAnswers.at(-1).show_alert,true);assert.ok(callbackAnswers.at(-1).text.length<=200);assert.equal(txCount,beforePopupTx);assert.equal(drafts.length,beforeClarification);
configStore.GEMINI_API_KEY='gemini-test';geminiMode='finance';await message('124','aku kasih pinjaman ke Nuno tunai 500k');assert.equal(drafts.length,beforeClarification+1);assert.equal(drafts.at(-1).payload.kind,'receivable_disbursement');assert.equal(drafts.at(-1).payload.contact_name,'Nuno');
geminiMode='financeWrongAmount';await message('124','aku kasih pinjaman ke Nuno tunai 500k');assert.equal(drafts.length,beforeClarification+1);assert.match(sent.at(-1).text,/belum cocok/);
geminiMode='financeExpense';await message('124','aku kasih pinjaman ke Nuno tunai 500k');assert.equal(drafts.length,beforeClarification+1);assert.match(sent.at(-1).text,/Pembayaran belum jelas/);
geminiMode='rate';await message('124','aku kasih pinjaman ke Nuno tunai 500k');assert.equal(drafts.length,beforeClarification+1);assert.ok(sent.at(-1).reply_markup.inline_keyboard.flat().some(b=>b.callback_data==='examples'));
console.log('PASS: exact user chats, unchanged source description, wallet-copy correction buttons, popup callback writes nothing, Gemini financial rewrites validated, incorrect amounts and ordinary expense for loans rejected, quota fallback offers examples.');

for(const text of ['nuno pinjam saya tunai 500k','nuno piutang 500k tunai','nuno piutang dari tunai 500k']){const p=parseSimple(text,yudiWallets,financeNow);assert.equal(p.kind,'receivable_disbursement');assert.equal(p.wallet_id,'yudi-cash');}
assert.equal(validateAiFinancialRewrite(originalFinance+' lalu transfer lain','piutang Nuno 500k Tunai',wallets,financeNow),null);
assert.equal(parseSimple('belum nuno pinjam saya 500k tunai',wallets,financeNow).intent,'unknown');
console.log('PASS: same everyday loan messages work for both brand wallet labels; negation and extra transaction remain blocked.');

assert.equal(parseSimple('nuno nyicil sejuta masuk tunai',wallets).amount,1000000);
assert.equal(parseSimple('nuno bayar dua ratus tiga puluh lima ribu tunai',wallets).amount,235000);
const assistantReq=(body,token='client-test',origin='https://bigbossyudi.vercel.app')=>new Request('https://test.supabase.co/functions/v1/telegram-webhook/assistant',{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),Origin:origin},body:JSON.stringify(body)});
assert.equal((await handler(assistantReq({action:'recap'},''))).status,401);
const readsBeforePending=privateReads;profileStatus='pending';assert.equal((await handler(assistantReq({action:'recap'}))).status,403);assert.equal(privateReads,readsBeforePending);profileStatus='trial';
const draftBeforeWeb=drafts.length;const webPreview=await handler(assistantReq({action:'chat',text:'masuk 2juta tunai',owner_id:'foreign'}));assert.equal(webPreview.headers.get('access-control-allow-origin'),'https://bigbossyudi.vercel.app');const preview=await webPreview.json();assert.equal(preview.type,'draft');assert.equal(preview.parsed.amount,2000000);assert.equal(drafts.length,draftBeforeWeb);
recapTxs=[{kind:'income',amount:500000,wallet_id:'cash',occurred_at:'2026-10-03T01:00:00Z'},{kind:'debt_disbursement',amount:1000000,wallet_id:'cash',occurred_at:'2026-10-03T01:00:00Z'},{kind:'expense',amount:100000,wallet_id:'cash',occurred_at:'2026-10-03T01:00:00Z'}];geminiMode='rate';
const webRecap=await handler(assistantReq({action:'recap',period:'daily',anchor:'2026-10-03',owner_id:'foreign'}));const summaryResult=await webRecap.json();assert.equal(summaryResult.type,'recap');assert.equal(summaryResult.recap.income,500000);assert.equal(summaryResult.recap.cashIn,1500000);assert.equal(summaryResult.ai,false);assert.equal((await handler(assistantReq({action:'recap',period:'daily',anchor:'2026-02-30'}))).status,400);
const thirdReads=privateReads;await message('125','rekap tahunan');assert.match(sent.at(-1).text,/hanya memiliki akses transaksi/);assert.equal(privateReads,thirdReads);await message('124','rekap hari ini');assert.match(sent.at(-1).text,/📊 Rekap/);
console.log('PASS: web assistant authenticated owner only, inactive denied before finance reads, preview has zero writes, client owner spoof ignored, BIGBOS CORS, accurate recap with AI quota fallback, invalid date rejected, Telegram third cannot access recap.');

geminiMode='narrative';const explained=await handler(assistantReq({action:'recap',period:'monthly',anchor:'2026-10-03'}));const explainedResult=await explained.json();assert.equal(explainedResult.ai,true);assert.match(explainedResult.explanation,/Pendapatan tercatat/);assert.equal(explainedResult.recap.income,500000);console.log('PASS: Gemini recap narrative is returned with server-computed figures unchanged.');

const assistant=body=>handler(assistantReq(body));
geminiMode='receipt';recapTxs=[{id:'00000000-0000-4000-8000-000000000099',recorder_telegram_id:'124'}];
const receiptBefore=txCount,receiptDrafts=drafts.length;
const receiptBody={action:'receipt',image:'/9j/AA==',mime_type:'image/jpeg',kind:'expense',wallet_id:'cash'};
const photoResponse=await assistant(receiptBody);assert.equal(photoResponse.status,200);const photoResult=await photoResponse.json();assert.equal(photoResult.type,'receipt');assert.equal(photoResult.parsed.amount,125000);assert.equal(photoResult.parsed.receipt_date,'2026-10-02');assert.equal(photoResult.parsed.wallet_id,'cash');assert.equal(txCount,receiptBefore);assert.equal(drafts.length,receiptDrafts);
geminiMode='receiptUnclear';assert.equal((await(await assistant(receiptBody)).json()).type,'clarification');geminiMode='rate';assert.equal((await(await assistant(receiptBody)).json()).type,'clarification');assert.equal((await assistant({...receiptBody,image:'YWJjZA=='})).status,400);assert.equal((await assistant({...receiptBody,image:'A'.repeat(3200001)})).status,400);
cancelDone=false;const cancelWeb=await(await assistant({action:'chat',text:'batal transaksi terakhir',owner_id:'foreign'})).json();assert.equal(cancelWeb.type,'cancel_preview');assert.equal(cancellationCalls.at(-1).body.p_confirm,false);assert.equal(cancellationCalls.at(-1).authorization,'Bearer client-test');assert.equal(cancelDone,false);
await assistant({action:'cancel_confirm',transaction_id:cancelWeb.transaction_id});assert.equal(cancellationCalls.at(-1).body.p_confirm,true);assert.equal(cancelDone,true);
cancelDone=false;await message('124','/batal');assert.match(sent.at(-1).text,/Batalkan transaksi tersimpan/);assert.equal(cancellationCalls.at(-1).body.p_chat_id,'124');assert.equal(cancellationCalls.at(-1).body.p_confirm,false);assert.match(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data,/^undo:/);
const undoPayload={callback_query:{id:'undo-cb',from:{id:124},data:'undo:'+recapTxs[0].id,message:{chat:{id:124,type:'private'}}}};
await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook',{method:'POST',headers:{'x-telegram-bot-api-secret-token':settings.TELEGRAM_WEBHOOK_SECRET},body:JSON.stringify(undoPayload)}));assert.equal(cancellationCalls.at(-1).body.p_confirm,true);assert.match(sent.at(-1).text,/dibatalkan/);
console.log('PASS: receipt inline image/structured total/date parsing, no writes before review, unreadable/quota/invalid/oversized rejected; web cancellation uses caller JWT, Telegram cancellation preview then confirmed RPC.');

// Test: Photo receipt with wallet in caption
geminiMode = 'receipt';
const photoMsg = (chat, caption, photoId = 'photo_123') => handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': settings.TELEGRAM_WEBHOOK_SECRET },
  body: JSON.stringify({
    message: {
      message_id: messageId++,
      caption,
      photo: [{ file_id: 'thumb', width: 90, height: 90 }, { file_id: photoId, width: 800, height: 800 }],
      chat: { id: +chat, type: 'private' },
      date: 1790969160,
      from: { id: +chat, first_name: 'Istri_*' }
    }
  })
}));

const draftCountBeforePhoto = drafts.length;
await photoMsg('124', 'belanja bca');
assert.equal(drafts.length, draftCountBeforePhoto + 1);
assert.equal(drafts.at(-1).payload.amount, 125000);
assert.equal(drafts.at(-1).payload.wallet_id, 'bca');
assert.match(sent.at(-1).text, /125\.000/);
assert.match(sent.at(-1).text, /BCA/);

// Test: Photo receipt without wallet in caption (incomplete -> popup choice buttons)
await photoMsg('124', '');
assert.equal(drafts.length, draftCountBeforePhoto + 2);
assert.equal(drafts.at(-1).payload.wallet_id, null);
assert.match(sent.at(-1).text, /Pilih dompet pembayaran/);
const choiceButtons = sent.at(-1).reply_markup.inline_keyboard.flat();
assert.ok(choiceButtons.some(b => b.callback_data && b.callback_data.startsWith('pick_w:')));
assert.ok(choiceButtons.some(b => b.callback_data === 'popup:photo_help'));

// Test: Selecting wallet via pick_w callback
const incompleteDraft = drafts.at(-1);
const pickPayload = {
  callback_query: {
    id: 'pick_cb',
    from: { id: 124 },
    data: 'pick_w:' + incompleteDraft.id + ':cash',
    message: { chat: { id: 124, type: 'private' } }
  }
};
await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook', {
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': settings.TELEGRAM_WEBHOOK_SECRET },
  body: JSON.stringify(pickPayload)
}));
assert.equal(incompleteDraft.payload.wallet_id, 'cash');
assert.match(sent.at(-1).text, /Tunai/);
assert.equal(sent.at(-1).reply_markup.inline_keyboard[0][0].callback_data, 'save:' + incompleteDraft.id);

// Test: Popups
const photoHelpPayload = {
  callback_query: {
    id: 'help_cb',
    from: { id: 124 },
    data: 'popup:photo_help',
    message: { chat: { id: 124, type: 'private' } }
  }
};
await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook', {
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': settings.TELEGRAM_WEBHOOK_SECRET },
  body: JSON.stringify(photoHelpPayload)
}));
assert.equal(callbackAnswers.at(-1).show_alert, true);
assert.match(callbackAnswers.at(-1).text, /Tips Foto Struk/);

// Test: Conversational AI (Chat Intent)
geminiMode = 'chat';
await message('124', 'halo bot, apa kabar?');
assert.match(sent.at(-1).text, /Halo! Ada yang bisa saya bantu/);
const chatButtons = sent.at(-1).reply_markup.inline_keyboard.flat();
assert.ok(chatButtons.some(b => b.callback_data === 'cmd:saldo'));
assert.ok(chatButtons.some(b => b.callback_data === 'popup:photo_help'));

// Test: Quick Command Callback (cmd:saldo)
const saldoCmdPayload = {
  callback_query: {
    id: 'saldo_cb',
    from: { id: 124 },
    data: 'cmd:saldo',
    message: { chat: { id: 124, type: 'private' } }
  }
};
await handler(new Request('https://test.supabase.co/functions/v1/telegram-webhook', {
  method: 'POST',
  headers: { 'x-telegram-bot-api-secret-token': settings.TELEGRAM_WEBHOOK_SECRET },
  body: JSON.stringify(saldoCmdPayload)
}));
assert.match(sent.at(-1).text, /Saldo keluarga/);

console.log('PASS: Telegram full AI photo receipt recognition, incomplete command popup buttons, wallet pick callback, and conversational AI.');
