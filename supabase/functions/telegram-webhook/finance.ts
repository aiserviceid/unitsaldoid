export function wibDate(value:Date|string=new Date()):string{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
function date(s:string):Date{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('Tanggal tidak valid');const d=new Date(s+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw Error('Tanggal tidak valid');return d;}
function iso(d:Date):string{return d.toISOString().slice(0,10);}
function shift(s:string,n:number):string{const d=date(s);d.setUTCDate(d.getUTCDate()+n);return iso(d);}
export function periodRange(period:string,anchor=wibDate(),from?:string,to?:string):any{
 const d=date(anchor);let start=anchor,end=anchor,previousStart='',previousEnd='';
 if(period==='daily'){previousStart=previousEnd=shift(start,-1);}
 else if(period==='weekly'){start=shift(anchor,-((d.getUTCDay()+6)%7));end=shift(start,6);previousStart=shift(start,-7);previousEnd=shift(end,-7);}
 else if(period==='monthly'){start=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)));end=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)));previousStart=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)));previousEnd=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0)));}
 else if(period==='yearly'){start=d.getUTCFullYear()+'-01-01';end=d.getUTCFullYear()+'-12-31';previousStart=(d.getUTCFullYear()-1)+'-01-01';previousEnd=(d.getUTCFullYear()-1)+'-12-31';}
 else if(period==='custom'){start=iso(date(from||''));end=iso(date(to||''));const days=Math.round((+date(end)-+date(start))/86400000)+1;if(days<1||days>366)throw Error('Rentang maksimal 366 hari');previousEnd=shift(start,-1);previousStart=shift(start,-days);}
 else throw Error('Periode tidak dikenal');
 return {period,start,end,previousStart,previousEnd};
}
const incoming=['income','debt_disbursement','receivable_payment'],outgoing=['expense','debt_payment','receivable_disbursement'];
function cash(t:any):number{return incoming.includes(t.kind)?Number(t.amount):outgoing.includes(t.kind)?-Number(t.amount):0;}
function totals(rows:any[]):any{const sum=(k:string)=>rows.filter(t=>t.kind===k).reduce((a,t)=>a+Number(t.amount),0);const income=sum('income'),expense=sum('expense'),cashIn=rows.filter(t=>incoming.includes(t.kind)).reduce((a,t)=>a+Number(t.amount),0),cashOut=rows.filter(t=>outgoing.includes(t.kind)).reduce((a,t)=>a+Number(t.amount),0);return {income,expense,cashIn,cashOut,net:cashIn-cashOut,debtReceived:sum('debt_disbursement'),debtPaid:sum('debt_payment'),receivableGiven:sum('receivable_disbursement'),receivablePaid:sum('receivable_payment'),count:rows.length};}
export function buildRecap(txs:any[],wallets:any[],obligations:any[],categories:any[],range:any):any{
 const start=Date.parse(range.start+'T00:00:00+07:00'),end=Date.parse(shift(range.end,1)+'T00:00:00+07:00'),ps=Date.parse(range.previousStart+'T00:00:00+07:00'),pe=Date.parse(shift(range.previousEnd,1)+'T00:00:00+07:00');
 const rows=txs.filter(t=>Date.parse(t.occurred_at)>=start&&Date.parse(t.occurred_at)<end),previous=totals(txs.filter(t=>Date.parse(t.occurred_at)>=ps&&Date.parse(t.occurred_at)<pe));
 const group=(key:(t:any)=>string,selected:any[])=>Object.entries(selected.reduce((a:any,t:any)=>{const k=key(t);a[k]=(a[k]||0)+Number(t.amount);return a;},{})).map(([name,amount])=>({name,amount})).sort((a:any,b:any)=>b.amount-a.amount);
 const balances=wallets.map(w=>{const delta=(t:any)=>t.kind==='transfer'?(t.destination_wallet_id===w.id?Number(t.amount):0)-(t.wallet_id===w.id?Number(t.amount):0):t.wallet_id===w.id?cash(t):0;return {id:w.id,name:w.name,opening:txs.filter(t=>Date.parse(t.occurred_at)<start).reduce((a,t)=>a+delta(t),0),closing:txs.filter(t=>Date.parse(t.occurred_at)<end).reduce((a,t)=>a+delta(t),0)};});
 const pending=obligations.filter(o=>Date.parse(o.issued_at||o.created_at)<end).map(o=>({name:o.contact_name,type:o.type,due_date:o.due_date,remaining:Math.max(0,Number(o.principal)-(o.obligation_payments||[]).filter((p:any)=>Date.parse(p.paid_at)<end).reduce((a:number,p:any)=>a+Number(p.amount),0))})).filter(o=>o.remaining>0);
 return {...range,...totals(rows),previous,opening:balances.reduce((a,w)=>a+w.opening,0),closing:balances.reduce((a,w)=>a+w.closing,0),wallets:balances,categories:group(t=>categories.find(c=>c.id===t.category_id)?.name||'Tanpa kategori',rows.filter(t=>t.kind==='expense')),recorders:group(t=>t.recorder_name||'Pemilik akun',rows),pending,pendingDebt:pending.filter(o=>o.type==='debt').reduce((a,o)=>a+o.remaining,0),pendingReceivable:pending.filter(o=>o.type==='receivable').reduce((a,o)=>a+o.remaining,0)};
}
const idr=(n:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);
export function recapText(r:any):string{return `📊 Rekap ${r.start} — ${r.end}\n\n💰 Pendapatan: ${idr(r.income)}\n🛒 Pengeluaran: ${idr(r.expense)}\n📥 Arus kas masuk: ${idr(r.cashIn)}\n📤 Arus kas keluar: ${idr(r.cashOut)}\n↔️ Arus kas bersih: ${idr(r.net)}\n👛 Saldo awal → akhir: ${idr(r.opening)} → ${idr(r.closing)}\n\n🤝 Terima utang: ${idr(r.debtReceived)}\n💸 Bayar utang: ${idr(r.debtPaid)}\n📨 Beri piutang: ${idr(r.receivableGiven)}\n✅ Terima cicilan piutang: ${idr(r.receivablePaid)}\n📉 Sisa utang: ${idr(r.pendingDebt)}\n📈 Sisa piutang: ${idr(r.pendingReceivable)}\n🧾 Transaksi: ${r.count}\n\nTransfer antar-dompet tidak dihitung sebagai pendapatan atau pengeluaran.`;}
export function recapRequest(text:string,now=new Date()):any|null{
 const s=text.toLowerCase();if(!/\b(rekap|ringkasan|laporan|rangkum)\b/.test(s))return null;
 let period='monthly',anchor=wibDate(now);if(/\b(harian|hari ini|kemarin)\b/.test(s)){period='daily';if(s.includes('kemarin'))anchor=shift(anchor,-1);}
 else if(/\b(mingguan|minggu ini|minggu lalu)\b/.test(s)){period='weekly';if(s.includes('minggu lalu'))anchor=shift(anchor,-7);}
 else if(/\b(tahunan|tahun ini|tahun lalu)\b/.test(s)){period='yearly';if(s.includes('tahun lalu'))anchor=(Number(anchor.slice(0,4))-1)+anchor.slice(4);}
 else if(/bulan lalu/.test(s)){const d=date(anchor);anchor=iso(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,1)));}
 const explicit=s.match(/\b(\d{4}-\d{2}-\d{2})\b/);if(explicit)anchor=explicit[1];return periodRange(period,anchor);
}
