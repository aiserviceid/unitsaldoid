// One-time provisioning is complete. This endpoint no longer creates or modifies accounts.
Deno.serve(()=>new Response('Provisioning closed',{status:410}));
