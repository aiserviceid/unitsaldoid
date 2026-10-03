export const HELP = `UnitSaldo — pembukuan keluarga

/saldo — saldo semua dompet
/utang — sisa utang
/piutang — sisa piutang
/laporan — arus kas bulan ini
/bantuan — contoh perintah
/batal — batalkan transaksi terakhir Anda setelah konfirmasi

Contoh:
• beli beras 75rb pakai tunai
• terima gaji 3jt ke BCA
• transfer 100rb dari BCA ke DANA
• rekap hari ini / minggu ini / bulan ini / tahunan

Sudah tersimpan tetapi salah? Kirim "batal transaksi terakhir", lalu konfirmasi pembatalan.
Bot menampilkan ringkasan. Tekan Simpan untuk mencatat, atau Batal.
Piutang: Nuno pinjam saya 500rb Tunai, atau Nuno piutang 500rb Tunai.
Utang saya: saya pinjam Nuno 500rb Tunai.
Cicilan masuk: Nuno bayar 200rb Tunai. Cicilan keluar: bayar utang Nuno 200rb Tunai.
Nama, nominal, dan dompet boleh ditulis dengan urutan berbeda. Periksa arah uang pada ringkasan sebelum Simpan.
Suami, istri, dan anak boleh terhubung ke akun yang sama; buat kode baru untuk setiap anggota.`;
export const formatIDR = (n: number) => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);
export function nominal(s: string): number {
  const m=s.trim().toLowerCase().match(/^(?:rp\s*)?(\d[\d.,]*)(?:\s*(rb|ribu|k|jt|juta))?$/);
  if(!m)return 0;
  let digits=m[1];const suffix=m[2];
  if(suffix){if(digits.includes(',')&&digits.includes('.'))digits=digits.replaceAll('.','').replace(',','.');else digits=digits.replace(',','.');}
  else if(/^\d{1,3}(?:[.,]\d{3})+$/.test(digits))digits=digits.replace(/[.,]/g,'');
  else if(digits.includes(',')||digits.includes('.'))return 0;
  const value=Number(digits)*(suffix?/^(jt|juta)$/.test(suffix)?1e6:1e3:1);
  return Number.isSafeInteger(value)&&value>0&&value<=1e12?value:0;
}
export function walletBalance(id: string,txs: any[]): number {
  return txs.reduce((sum,t)=>sum+(t.wallet_id===id?(['income','debt_disbursement','receivable_payment'].includes(t.kind)?Number(t.amount):-Number(t.amount)):0)+(t.kind==='transfer'&&t.destination_wallet_id===id?Number(t.amount):0),0);
}
export function readIntent(text: string): string|null {
  const s=text.toLowerCase().trim();
  if(/^(\/saldo(?:@\w+)?|(?:cek|lihat|berapa)\s+saldo(?:\s+(?:saya|kita|sekarang|semua))?)\??$/.test(s))return 'balance';
  if(/^(\/(?:utang|hutang)(?:@\w+)?|(?:cek|lihat|berapa)\s+(?:utang|hutang)(?:\s+(?:saya|kita))?)\??$/.test(s))return 'debt';
  if(/^(\/piutang(?:@\w+)?|(?:cek|lihat|berapa)\s+piutang(?:\s+(?:saya|kita))?)\??$/.test(s))return 'receivable';
  if(/^\/(?:laporan|analisis)(?:@\w+)?$/.test(s))return 'report';
  if(/^(\/(?:help|bantuan)(?:@\w+)?|halo|hai|bantuan)$/.test(s))return 'help';
  return null;
}
// Explicit names separated by '/' or '|' are equivalent labels, never arbitrary guesses.
function walletAliases(wallet:any):string[]{
 const name=String(wallet.name||'').trim().replace(/\s+/g,' ');
 return [...new Set([name,...name.split(/[\/|]/).map(v=>v.trim()).filter(v=>v.length>=2)])].filter(Boolean).sort((a,b)=>b.length-a.length);
}
function walletPattern(name:string):RegExp{
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s+');
 return new RegExp('(^|[^\\p{L}\\p{N}])'+escaped+'(?=$|[^\\p{L}\\p{N}])','iu');
}
export function matchingWallets(text:string,wallets:any[]):any[]{return wallets.filter(w=>walletAliases(w).some(name=>walletPattern(name).test(text)));}
function removeWalletNames(text:string,wallet:any):string{
 return walletAliases(wallet).reduce((value,name)=>value.replace(new RegExp(walletPattern(name).source,'giu'),'$1'),text);
}

export function normalizeChatText(text:string):string {
 const terms:Record<string,string>={byr:'bayar',bayr:'bayar',membayar:'bayar',nyicil:'cicil',mencicil:'cicil',cicl:'cicil',piutng:'piutang',piutag:'piutang',pihutang:'piutang',piutangg:'piutang',utng:'utang',hutng:'hutang',htang:'hutang',pnjam:'pinjam',pijam:'pinjam',minjem:'pinjam',minjam:'pinjam',meminjam:'pinjam',pinjem:'pinjam',trima:'terima',tnai:'tunai',tunia:'tunai'};
 const units:Record<string,number>={satu:1,dua:2,tiga:3,empat:4,lima:5,enam:6,tujuh:7,delapan:8,sembilan:9};
 const words=(s:string)=>{let total=0,pending=0;for(const w of s.trim().toLowerCase().split(/\s+/)){if(units[w])pending+=units[w];else if(w==='puluh'){total+=pending*10;pending=0;}else if(w==='ratus'){total+=pending*100;pending=0;}else if(w==='belas'){total+=pending+10;pending=0;}else total+=w==='sepuluh'?10:w==='sebelas'?11:100;}return total+pending;};
 return text.replace(/\bsejuta\b/gi,'1juta').replace(/\bseribu\b/gi,'1ribu').replace(/\bsetengah juta\b/gi,'500ribu').replace(/\b((?:(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|seratus|puluh|ratus|belas)\s+){1,10})(juta|ribu)\b/gi,(_,n,s)=>words(n)+s.toLowerCase()).replace(/\b[a-z]+\b/gi,word=>terms[word.toLowerCase()]||word).replace(/\s+/g,' ').trim();
}
// Move a wallet placed before the amount behind it, leaving the person's name intact.
function reorderFinancialWallet(text:string,wallets:any[]):string {
 const amount=[...text.matchAll(/(?:rp\s*)?\d[\d.,]*(?:\s*(?:juta|ribu|jt|rb|k))?/gi)][0];
 if(!amount||!amount.index)return text;
 const before=text.slice(0,amount.index),after=text.slice(amount.index);
 const matches=wallets.flatMap(w=>walletAliases(w).map(alias=>({w,match:walletPattern(alias).exec(before)}))).filter(x=>x.match);
 for(const {w,match} of matches){
  const start=match!.index+match![1].length,prefix=before.slice(0,start);
  const person=prefix.replace(/\b(catat|piutang|utang|hutang|pinjam|bayar|cicil|melunasi|saya|aku|kami|kita|ke|dari|kepada|pakai|lewat|masuk|via|melalui)\b/gi,'').trim();
  if(!person)continue;
  const rest=before.slice(start+match![0].length-match![1].length).trim();
  if(rest)continue;
  return prefix.replace(/\b(ke|dari|pakai|lewat|masuk|via|melalui)\s*$/i,'').trim()+' '+after+' '+w.name;
 }
 return text;
}
export function parseSimple(text: string, wallets: any[], now:Date=new Date()): any|null {
  text=normalizeChatText(text);
  const lower=text.toLowerCase();
  const payment=parsePayment(text,wallets);if(payment)return payment;
  if(/\b(utang|hutang|piutang|pinjam)\b/.test(lower))return parseObligation(text,wallets,now);
  if(/\b(kemarin|besok|lusa|tanggal|tgl|jangan|belum|batal|mungkin|rencana|kalau|kalo)\b/.test(lower))return null;
  const matches=[...lower.matchAll(/(?:rp\s*)?\d[\d.,]*(?:\s*(?:juta|ribu|jt|rb|k))?/g)];
  if(matches.length!==1)return null;
  const amount=nominal(matches[0][0]);if(!amount)return null;
  const found=matchingWallets(text,wallets);
  const income=/\b(masuk|gaji|pemasukan|pendapatan|penghasilan|bonus|penjualan|omzet|terima|dapat)\b/.test(lower);
  const expense=/\b(keluar|beli|bayar|makan|belanja|pengeluaran|bensin|beras|listrik|kopi|jajan)\b/.test(lower);
  if(/\btransfer\b/.test(lower)){
    if(found.length!==2)return null;
    const from=lower.match(/\bdari\s+(.+?)\s+ke\s+(.+)$/);if(!from)return null;
    const source=found.find(w=>walletAliases(w).some(name=>from[1].trim().replace(/\s+/g,' ').toLowerCase()===name.toLowerCase()));const dest=found.find(w=>walletAliases(w).some(name=>from[2].trim().replace(/\s+/g,' ').toLowerCase()===name.toLowerCase()));
    if(!source||!dest||source.id===dest.id)return null;
    return {intent:'transaction',kind:'transfer',amount,description:text,wallet_id:source.id,destination_wallet_id:dest.id,category_id:null};
  }
  if(income===expense)return null;
  if(found.length>1)return {intent:'unknown',clarification:'Nama dompet cocok dengan beberapa dompet. Kirim ulang dengan nama lengkap satu dompet: '+found.map(w=>w.name).join(', ')+'.'};
  const wallet=found[0]||(wallets.length===1?wallets[0]:null);if(!wallet)return {intent:'unknown',clarification:'Nominal '+formatIDR(amount)+' sudah terbaca. Masuk/keluar lewat dompet mana? Pilih '+wallets.map(w=>w.name).join(', ')+'. Kirim ulang kalimat lengkap dengan nama dompet.'};
  return {intent:'transaction',kind:income?'income':'expense',amount,description:text,wallet_id:wallet.id,destination_wallet_id:null,category_id:null};
}


export function resolveDueDate(note:string,now:Date=new Date()):{date:string|null,clarification?:string} {
 const s=note.trim().toLowerCase().replace(/\s+/g,' ');
 if(!s)return {date:null};
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>Number(parts.find(p=>p.type===type)?.value);
 const year=part('year'),month=part('month'),day=part('day');
 const valid=(y:number,m:number,d:number)=>{
  const date=new Date(Date.UTC(y,m-1,d));
  if(y<2000||y>2100||date.getUTCFullYear()!==y||date.getUTCMonth()+1!==m||date.getUTCDate()!==d)return {date:null,clarification:'Tanggal jatuh tempo tidak valid. Tulis tanggal yang ada pada bulan tersebut.'};
  return {date:date.toISOString().slice(0,10)};
 };
 let match=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(match)return valid(+match[1],+match[2],+match[3]);
 match=s.match(/^(?:tanggal |tgl )?(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
 if(match)return valid(+match[3],+match[2],+match[1]);
 const shiftedMonth=(offset:number)=>new Date(Date.UTC(year,month-1+offset,1));
 match=s.match(/^(?:tanggal |tgl )?(\d{1,2}) bulan (depan|ini)$/);
 if(match){const target=shiftedMonth(match[2]==='depan'?1:0);return valid(target.getUTCFullYear(),target.getUTCMonth()+1,+match[1]);}
 match=s.match(/^akhir bulan (depan|ini)$/);
 if(match){const target=shiftedMonth(match[1]==='depan'?2:1);target.setUTCDate(0);return valid(target.getUTCFullYear(),target.getUTCMonth()+1,target.getUTCDate());}
 if(s==='bulan depan'||s==='bulan ini'){
  const target=shiftedMonth(s==='bulan depan'?1:0);
  const label=new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'UTC'}).format(target);
  return {date:null,clarification:label+' sudah terbaca. Jatuh tempo tanggal berapa? Kirim ulang kalimat lengkap, misalnya: piutang Nuno 500rb Tunai bayar tanggal 10 '+s+'.'};
 }
 let days:number|null=s==='hari ini'?0:s==='besok'?1:s==='lusa'?2:null;
 match=s.match(/^(?:dalam )?(\d{1,3}) (hari|minggu)(?: lagi| dari sekarang)?$/);
 if(match)days=+match[1]*(match[2]==='minggu'?7:1);
 if(days!==null){const target=new Date(Date.UTC(year,month-1,day+days));return valid(target.getUTCFullYear(),target.getUTCMonth()+1,target.getUTCDate());}
 return {date:null,clarification:'Tanggal jatuh tempo belum jelas. Gunakan “tanggal 10 bulan depan”, “akhir bulan depan”, “besok”, “8 hari lagi”, atau YYYY-MM-DD. Kirim ulang kalimat lengkap.'};
}
export function formatDueDate(date:string):string {
 return new Intl.DateTimeFormat('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(date+'T00:00:00Z'));
}


export function parsePayment(text:string,wallets:any[]):any|null {
 text=reorderFinancialWallet(normalizeChatText(text),wallets);
 const patterns:[RegExp,string][]=[
  [/^(.+?)\s+(?:bayar|cicil|melunasi)\s+(?:utang|hutang)(?:\s+ke\s+(?:saya|kami|kita))?\s+(?:rp\s*)?(\d[\d.,]*(?:\s*(?:juta|ribu|jt|rb|k))?)(.*)$/i,'receivable'],
  [/^(?:saya\s+)?(?:bayar|cicil|lunasi)\s+(?:utang|hutang)\s+(?:ke\s+)?(.+?)\s+(?:rp\s*)?(\d[\d.,]*(?:\s*(?:juta|ribu|jt|rb|k))?)(.*)$/i,'debt'],
  [/^(?!saya\b|aku\b|kami\b|kita\b)(.+?)\s+(?:bayar|cicil|melunasi)\s+(?:rp\s*)?(\d[\d.,]*(?:\s*(?:juta|ribu|jt|rb|k))?)(.*)$/i,'receivable'],
  [/^(?:terima|terima pembayaran)\s+piutang\s+(?:dari\s+)?(.+?)\s+(?:rp\s*)?(\d[\d.,]*(?:\s*(?:juta|ribu|jt|rb|k))?)(.*)$/i,'receivable']
 ];
 let match:RegExpMatchArray|null=null,type='';
 for(const [pattern,t] of patterns){match=text.trim().match(pattern);if(match){type=t;break;}}
 const unknown=(clarification:string)=>({intent:'unknown',clarification});
 if(!match){
  if(/^(?!saya\b|aku\b|kami\b|kita\b).+?\s+(?:bayar|cicil|melunasi)(?:\s+(?:utang|hutang|piutang))?\s*$/i.test(text.trim()))return unknown('Lengkapi nominal dan dompet pembayaran. Contoh: Ipud bayar 1juta Tunai.');
  return null;
 }
 if(/\b(belum|jangan|batal|mungkin|rencana|kemarin|besok|lusa)\b/i.test(text))return unknown('Catat hanya pembayaran yang sudah terjadi hari ini.');
 const contact=match[1].trim(),amount=nominal(match[2]),tail=match[3].trim();
 if(!contact||contact.length>100||!amount)return unknown('Nama dan nominal pembayaran belum jelas. Contoh: Nuno bayar hutang 200rb Tunai.');
  const found=matchingWallets(tail,wallets);
 if(found.length>1)return unknown('Pilih satu dompet untuk pembayaran ini.');
 const rest=found.reduce((v,w)=>removeWalletNames(v,w),tail).replace(/\b(ke|dari|pakai|lewat|masuk|via|melalui|saya|kami|kita)\b/gi,'').trim();
 if(rest)return unknown('Tulis satu pembayaran per pesan. Contoh: Nuno bayar hutang 200rb Tunai.');
 const wallet=found[0]||(wallets.length===1?wallets[0]:null);
 if(!wallet)return {...unknown('Pembayaran '+contact+' '+formatIDR(amount)+'. '+(type==='receivable'?'Uang masuk ke':'Uang keluar dari')+' dompet mana?'),suggestions:wallets.slice(0,4).map(w=>(type==='receivable'?contact+' bayar ':'bayar utang '+contact+' ')+amount+' '+w.name)};
 return {intent:'payment',kind:type==='debt'?'debt_payment':'receivable_payment',obligation_type:type,contact_name:contact,amount,wallet_id:wallet.id,category_id:null,destination_wallet_id:null,description:text.slice(0,300)};
}

export function parseObligation(text:string,wallets:any[],now:Date=new Date()):any {
 text=normalizeChatText(text);
 const unknown=(clarification:string)=>({intent:'unknown',clarification});
 if(/\b(belum|jangan|batal|mungkin|rencana|kemarin|besok|lusa)\b/i.test(text.split(/\b(?:jatuh tempo|bayar)\s+/i)[0]))return unknown('Catat hanya uang utang/piutang yang sudah diterima atau diberikan hari ini.');
 if(/^\s*(bayar|cicil|lunasi|terima pembayaran)\b/i.test(text))return unknown('Pembayaran atau cicilan utang/piutang masih melalui menu Utang & Piutang di web.');
 const parts=text.split(/\b(?:jatuh tempo|bayar)\s+/i);
 if(parts.length>2)return unknown('Tulis satu utang/piutang per pesan.');
 const body=reorderFinancialWallet(parts[0].trim(),wallets),dueNote=(parts[1]||'').trim();
 if(/(^|[\s:])-\s*\d/.test(body))return unknown('Nominal utang/piutang harus lebih besar dari nol.');
 const patterns:[RegExp,string][]=[
  [/^(?:catat\s+)?piutang\s+(.+?)\s+(?:rp\s*)?(?=\d)/i,'receivable'],
  [/^(?:catat\s+)?(?:saya|aku|kami|kita)\s+(?:utang|hutang|pinjam)\s+(?:(?:ke|dari|kepada)\s+)?(.+?)\s+(?:rp\s*)?(?=\d)/i,'debt'],
  [/^(?:catat\s+)?(?:utang|hutang)\s+(?:saya|kami|kita)\s+(?:ke|dari|kepada)\s+(.+?)\s+(?:rp\s*)?(?=\d)/i,'debt'],
  [/^(?:catat\s+)?(?:utang|hutang|pinjam)\s+(?:ke|dari|kepada)\s+(.+?)\s+(?:rp\s*)?(?=\d)/i,'debt'],
  [/^(.+?)\s+(?:utang|hutang|pinjam)\s+(?:(?:ke|dari|kepada)\s+)?(?:saya|aku|kami|kita)\s+(?:rp\s*)?(?=\d)/i,'receivable'],
  [/^(?!saya\b|aku\b|kami\b|kita\b)(.+?)\s+(?:piutang|utang|hutang|pinjam)\s+(?:rp\s*)?(?=\d)/i,'receivable']
 ];
 let match:RegExpMatchArray|null=null,type='';
 for(const [pattern,t] of patterns){match=body.match(pattern);if(match){type=t;break;}}
 if(!match)return {...unknown('Siapa yang menerima uang? Contoh: Nuno pinjam saya 500rb Tunai; saya pinjam Nuno 500rb Tunai.'),allow_ai:true};
 const contact=match[1].trim();if(!contact||contact.length>100)return unknown('Nama orang belum jelas.');
 const due=resolveDueDate(dueNote,now);
 if(due.clarification)return unknown(due.clarification);
 const dueDate=due.date;
 const amounts=[...body.matchAll(/(?:rp\s*)?\d[\d.,]*(?:\s*(?:juta|ribu|jt|rb|k))?/gi)];
 if(amounts.length!==1)return unknown('Tulis satu nominal, misalnya 500rb. Tanggal jatuh tempo ditulis setelah “bayar” atau “jatuh tempo”.');
 const amount=nominal(amounts[0][0]);if(!amount)return unknown('Nominal belum jelas. Tulis 500rb atau 500000.');
 // Match wallets only after the amount so a person's name cannot select a wallet.
 const tail=body.slice((amounts[0].index||0)+amounts[0][0].length);
  const found=matchingWallets(tail,wallets);
 if(found.length>1)return unknown('Pilih satu dompet untuk uang utang/piutang ini.');
 const wallet=found[0]||(wallets.length===1?wallets[0]:null);
 if(!wallet)return {...unknown(contact+' '+formatIDR(amount)+'. Dompet mana?'),suggestions:wallets.slice(0,4).map(w=>(type==='receivable'?'piutang '+contact:'saya utang '+contact)+' '+amount+' '+w.name+(dueNote?' bayar '+dueNote:''))};
 const remaining=removeWalletNames(tail,wallet).replace(/\b(ke|dari|pakai|lewat|masuk|via|melalui)\b/gi,'').trim();
 if(remaining)return {...unknown('Tulis satu utang/piutang per pesan, misalnya: Nuno piutang 500rb Tunai.'),allow_ai:true};
 return {intent:'obligation',kind:type==='debt'?'debt_disbursement':'receivable_disbursement',obligation_type:type,contact_name:contact,amount,wallet_id:wallet.id,category_id:null,destination_wallet_id:null,due_date:dueDate,due_note:dueNote.slice(0,200),description:text.slice(0,300)};
}

// AI may rewrite a sentence, but the money, contact, wallet and date must come from the user.
export function validateAiFinancialRewrite(text:string,command:string,wallets:any[],now:Date):any|null {
 if(typeof command!=='string'||command.length>1200)return null;
 const source=normalizeChatText(text),parts=source.split(/\b(?:jatuh tempo|bayar)\s+(?=tanggal|tgl|bulan|akhir|besok|lusa|\d+\s+(?:hari|minggu))/i);
 if(parts.length>2||/\b(belum|jangan|batal|mungkin|rencana|kemarin|besok|lusa|kalau|kalo)\b/i.test(parts[0])||/(^|\s)-\s*\d/.test(parts[0])||/\b(dan|lalu|kemudian)\b.*\b(transfer|bayar|cicil|utang|hutang|piutang|pinjam|beli|masuk|keluar)\b/i.test(parts[0]))return null;
 const parsed=parseSimple(command,wallets,now);
 if(!parsed||!['obligation','payment'].includes(parsed.intent))return null;
 let amountText=parts[0];for(const w of wallets)amountText=removeWalletNames(amountText,w);
 const amounts=[...amountText.matchAll(/(?:rp\s*)?\d[\d.,]*(?:\s*(?:juta|ribu|jt|rb|k))?/gi)];
 if(amounts.length!==1||nominal(amounts[0][0])!==parsed.amount)return null;
 const contact=String(parsed.contact_name).trim();
 if(!walletPattern(contact).test(source))return null;
 const withoutContact=source.replace(new RegExp(walletPattern(contact).source,'iu'),'$1');
 const matches=matchingWallets(withoutContact,wallets);
 if(matches.length?matches.length!==1||matches[0].id!==parsed.wallet_id:wallets.length!==1)return null;
 const dueNote=(parts[1]||'').trim();
 if(parsed.intent==='obligation'){
  const due=resolveDueDate(dueNote,now);if(due.clarification||due.date!==parsed.due_date)return null;
  parsed.due_note=dueNote;
 }
 parsed.description=text.slice(0,300);return parsed;
}
export function validateParsed(p: any,wallets: any[],categories: any[]): string|null {
  if(!p||!['transaction','obligation','payment'].includes(p.intent)||!['income','expense','transfer','debt_disbursement','receivable_disbursement','debt_payment','receivable_payment'].includes(p.kind))return 'Belum memahami transaksi. Sebutkan jenis, nominal, dan dompet. Contoh: beli beras 75rb pakai Tunai.';
  if(p.intent==='obligation'&&(!['debt','receivable'].includes(p.obligation_type)||p.kind!==(p.obligation_type==='debt'?'debt_disbursement':'receivable_disbursement')||typeof p.contact_name!=='string'||!p.contact_name.trim()))return 'Jenis utang/piutang atau nama belum jelas.';
  if(p.intent==='payment'&&(!['debt','receivable'].includes(p.obligation_type)||p.kind!==(p.obligation_type==='debt'?'debt_payment':'receivable_payment')||typeof p.contact_name!=='string'||!p.contact_name.trim()))return 'Jenis pembayaran atau nama belum jelas.';
  if(p.intent==='transaction'&&!['income','expense','transfer'].includes(p.kind))return 'Jenis transaksi tidak valid.';
  if(!Number.isSafeInteger(p.amount)||p.amount<=0||p.amount>1e12)return 'Nominal belum jelas. Tulis angka, misalnya 75000 atau 75rb.';
  if(!wallets.some(w=>w.id===p.wallet_id))return 'Dompet belum jelas. Pilih salah satu: '+wallets.map(w=>w.name).join(', ');
  if(p.kind==='transfer'&&(!wallets.some(w=>w.id===p.destination_wallet_id)||p.wallet_id===p.destination_wallet_id))return 'Sebutkan dompet asal dan tujuan yang berbeda.';
  if(p.category_id&&!categories.some(c=>c.id===p.category_id&&c.type===p.kind))p.category_id=null;
  if(p.kind!=='transfer')p.destination_wallet_id=null;
  if(typeof p.description!=='string'||!p.description.trim())return 'Keterangan transaksi belum jelas.';
  p.description=p.description.slice(0,300);return null;
}
export function draftText(p:any,wallets:any[]): string {
  const source=wallets.find(w=>w.id===p.wallet_id)?.name;
  const dest=wallets.find(w=>w.id===p.destination_wallet_id)?.name;
  return `🔎 Periksa sebelum disimpan:\n\n${({income:'📥 Pemasukan',expense:'📤 Pengeluaran',transfer:'↔️ Transfer',debt_disbursement:'🤝 Terima utang — uang masuk',receivable_disbursement:'📨 Beri piutang — uang keluar',debt_payment:'💸 Bayar utang — uang keluar',receivable_payment:'✅ Terima pembayaran piutang — uang masuk'} as Record<string,string>)[p.kind]}\n💵 Nominal: ${formatIDR(p.amount)}\n👛 Dompet: ${source}${dest?' → '+dest:''}${p.intent==='obligation'?'\n👤 Nama: '+p.contact_name+'\n📅 Jatuh tempo: '+(p.due_date?formatDueDate(p.due_date):'Belum ditentukan'):p.intent==='payment'?'\n👤 Nama: '+p.contact_name:''}\n📝 Keterangan: ${p.description}${p.recorder_name?'\n✍️ Pencatat: '+p.recorder_name:''}\n\nBelum masuk pembukuan. Tekan Simpan jika sudah benar. Berlaku 15 menit.`;
}

export const TRANSACTION_HELP = `UnitSaldo — akses transaksi saja\n\nContoh:\n• beli beras 75rb pakai tunai\n• masuk 1 juta tunai\n• transfer 100rb dari BCA ke DANA\n\nPeriksa ringkasan lalu tekan Simpan atau Batal. Telegram ini tidak dapat melihat saldo, utang, piutang, atau laporan keluarga.`;
export const PRIVACY_DENIED = 'Telegram ini hanya memiliki akses transaksi. Saldo, utang, piutang, dan laporan keluarga hanya dapat dilihat dari Telegram pertama atau kedua.';
export function canViewFinances(link: {telegram_position?: number}): boolean { return link.telegram_position === 1 || link.telegram_position === 2; }
