import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const block=html.slice(html.indexOf("    $('#authForm').onsubmit"),html.indexOf("    $('#btnSignOut').onclick"));
const calls=[],redirects=[];
const helpers=html.slice(html.indexOf('    function normalizeWhatsApp'),html.indexOf('    // Auth\n')); 
function setup(signup,error=null){
 const elements={'#authForm':{},'#btnSubmitAuth':{disabled:false},'#authNotice':{textContent:''},'#authEmail':{value:'  test@example.com  '},'#authPassword':{value:'fixture-password'},'#authName':{value:'Nuno'},'#authWhatsApp':{value:'085382535050'}};
 const supabase={auth:{async signUp(args){calls.push({method:'signup',args});return {error};},async signInWithPassword(args){calls.push({method:'signin',args});return {error};}}};
 new Function('$','supabase','isSignupMode','window','escapeHTML',helpers+block)(key=>elements[key],supabase,signup,{location:{assign:url=>redirects.push(url)}},v=>String(v));
 return elements;
}
let e=setup(true);await e['#authForm'].onsubmit({preventDefault(){}});
assert.equal(calls.at(-1).args.options.emailRedirectTo,'https://unitsaldoid.vercel.app/');
assert.equal(calls.at(-1).args.email,'test@example.com');assert.equal(e['#btnSubmitAuth'].disabled,false);
e=setup(false);await e['#authForm'].onsubmit({preventDefault(){}});assert.equal(calls.at(-1).method,'signin');assert.equal(calls.at(-1).args.options,undefined);
e=setup(true,{message:'Test error'});await e['#authForm'].onsubmit({preventDefault(){}});assert.equal(e['#authNotice'].textContent,'Test error');assert.equal(e['#btnSubmitAuth'].disabled,false);
const before=calls.length;e['#btnSubmitAuth'].disabled=true;await e['#authForm'].onsubmit({preventDefault(){}});assert.equal(calls.length,before);
console.log('PASS: registration redirects to production, trims email, login unchanged, errors shown and button restored, duplicate submit guarded.');

assert.equal(calls.find(c=>c.method==='signup').args.options.data.full_name,'Nuno');assert.equal(calls.find(c=>c.method==='signup').args.options.data.whatsapp_number,'6285382535050');assert.ok(redirects[0].startsWith('https://wa.me/6285382535050?text='));assert.ok(decodeURIComponent(redirects[0]).includes('test@example.com'));assert.equal(redirects.length,1);e=setup(true);e['#authWhatsApp'].value='invalid';const count=calls.length;await e['#authForm'].onsubmit({preventDefault(){}});assert.equal(calls.length,count);assert.equal(redirects.length,1);console.log('PASS: signup metadata, WhatsApp activation redirect, invalid phone rejected, error/login never redirect.');

e=setup(false);e['#authEmail'].value='085382000666';await e['#authForm'].onsubmit({preventDefault(){}});assert.equal(calls.at(-1).args.phone,'+6285382000666');assert.equal(calls.at(-1).args.email,undefined);console.log('PASS: phone login uses real E164 identity, no synthetic email.');
