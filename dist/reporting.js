// All reporting periods use WIB. Financing is distinct from income/consumption.
export const IN_KINDS=['income','debt_disbursement','receivable_payment'];
export const OUT_KINDS=['expense','debt_payment','receivable_disbursement'];
export const KIND_LABELS={income:'Pendapatan',expense:'Belanja',transfer:'Transfer',debt_disbursement:'Terima pinjaman',debt_payment:'Bayar utang',receivable_disbursement:'Beri piutang',receivable_payment:'Terima piutang'};
export function bounds(year,month){return {start:Date.UTC(year,month,1)-7*3600000,end:Date.UTC(year,month+1,1)-7*3600000};}
export function recorderKey(t){return t.recorder_telegram_id?'tg:'+t.recorder_telegram_id:t.source==='telegram'?'name:'+(t.recorder_name||'Telegram lama'):'web';}
export function recorderName(t){return t.recorder_name||(t.source==='telegram'?'Telegram (nama belum tersedia)':'Web (pemilik akun)');}
export function delta(t,wallet='all'){
 const a=Number(t.amount)||0;
 if(t.kind==='transfer')return wallet==='all'?0:(t.destination_wallet_id===wallet?a:0)-(t.wallet_id===wallet?a:0);
 if(wallet!=='all'&&t.wallet_id!==wallet)return 0;
 return IN_KINDS.includes(t.kind)?a:OUT_KINDS.includes(t.kind)?-a:0;
}
export function reportData(transactions,obligations,categories,year,month,wallet='all',recorder='all',now=new Date()){
 const {start,end}=bounds(year,month),prev=bounds(year,month-1);
 const matches=t=>(wallet==='all'||t.wallet_id===wallet||t.destination_wallet_id===wallet)&&(recorder==='all'||recorderKey(t)===recorder);
 const rows=transactions.filter(t=>{const d=Date.parse(t.occurred_at);return d>=start&&d<end&&matches(t);});
 const previous=transactions.filter(t=>{const d=Date.parse(t.occurred_at);return d>=prev.start&&d<prev.end&&matches(t);});
 const sum=(rs,kind)=>rs.filter(t=>t.kind===kind).reduce((a,t)=>a+Number(t.amount),0);
 const income=sum(rows,'income'),expense=sum(rows,'expense');
 const cashIn=rows.reduce((a,t)=>a+(delta(t,wallet)>0?delta(t,wallet):0),0),cashOut=rows.reduce((a,t)=>a+(delta(t,wallet)<0?-delta(t,wallet):0),0);
 const opening=transactions.filter(t=>Date.parse(t.occurred_at)<start).reduce((a,t)=>a+delta(t,wallet),0);
 const closing=transactions.filter(t=>Date.parse(t.occurred_at)<end).reduce((a,t)=>a+delta(t,wallet),0);
 const categoryMap=new Map();rows.filter(t=>t.kind==='expense').forEach(t=>{const c=categories.find(c=>c.id===t.category_id);const key=c?.id||'uncategorized',name=c?.name||'Tanpa kategori';const row=categoryMap.get(key)||{name,total:0};row.total+=Number(t.amount);categoryMap.set(key,row);});
 const categoryRows=[...categoryMap.values()].sort((a,b)=>b.total-a.total).map(c=>({...c,pct:expense?c.total/expense*100:0}));
 const cutoff=Math.min(end,now.getTime()+1),cutoffDate=new Date(cutoff-1+7*3600000).toISOString().slice(0,10);
 const tags=obligations.filter(o=>!o.issued_at||Date.parse(o.issued_at)<cutoff).map(o=>{const payments=o.obligation_payments||[];const paid=payments.filter(p=>p.paid_at?Date.parse(p.paid_at)<cutoff:cutoff>=now.getTime()).reduce((a,p)=>a+Number(p.amount),0);const periodPaid=payments.filter(p=>p.paid_at&&Date.parse(p.paid_at)>=start&&Date.parse(p.paid_at)<cutoff).reduce((a,p)=>a+Number(p.amount),0);return {...o,paid,periodPaid,remaining:Math.max(0,Number(o.principal)-paid),overdue:!!o.due_date&&o.due_date<cutoffDate};});
 return {rows,previous,income,expense,surplus:income-expense,savingsRate:income>0?(income-expense)/income*100:null,cashIn,cashOut,net:cashIn-cashOut,opening,closing,categoryRows,previousIncome:sum(previous,'income'),previousExpense:sum(previous,'expense'),financingIn:sum(rows,'debt_disbursement')+sum(rows,'receivable_payment'),financingOut:sum(rows,'debt_payment')+sum(rows,'receivable_disbursement'),tags,cutoffDate,debt:tags.filter(o=>o.type==='debt').reduce((a,o)=>a+o.remaining,0),receivable:tags.filter(o=>o.type==='receivable').reduce((a,o)=>a+o.remaining,0),periodPaid:tags.reduce((a,o)=>a+o.periodPaid,0),overdue:tags.filter(o=>o.overdue&&o.remaining>0).reduce((a,o)=>a+o.remaining,0)};
}
export function changeLabel(current,previous){return previous===0?(current===0?'Tidak berubah':'Belum ada pembanding'):`${current>=previous?'Naik':'Turun'} ${Math.abs((current-previous)/previous*100).toLocaleString('id-ID',{maximumFractionDigits:1})}%`;}
export function csvCell(value){const s=String(value??'');return '"'+(/^[\s]*[=+\-@\t\r\n]/.test(s)?"'"+s:s).replaceAll('"','""')+'"';}
export function csvText(rows){return '\uFEFF'+rows.map(row=>row.map(v=>typeof v==='number'&&Number.isFinite(v)?String(v):csvCell(v)).join(';')).join('\r\n');}
