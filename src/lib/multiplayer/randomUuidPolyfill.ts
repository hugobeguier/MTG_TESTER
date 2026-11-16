// Browsers only expose crypto.randomUUID in a "secure context" (HTTPS or localhost). When the app is
// opened over a plain-http LAN/VPN address such as http://25.x.x.x:3000 (Hamachi), that function is
// missing and the game crashes at start ("crypto.randomUUID is not a function"). crypto.getRandomValues
// IS available in insecure contexts, so this script adds a spec-shaped (v4) randomUUID on top of it.
//
// It is delivered as a plain string so app/layout.tsx can inline it in <head>, where it runs before any
// bundle code. The engine/hooks call crypto.randomUUID in ~300 places; patching the global once is far
// less invasive than rewriting every call site.
export const RANDOM_UUID_POLYFILL = `(function(){try{var c=globalThis.crypto;if(!c||typeof c.randomUUID==="function"||typeof c.getRandomValues!=="function")return;c.randomUUID=function(){var b=new Uint8Array(16);c.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h=Array.prototype.map.call(b,function(x){return(x+256).toString(16).slice(1)});return h.slice(0,4).join("")+"-"+h.slice(4,6).join("")+"-"+h.slice(6,8).join("")+"-"+h.slice(8,10).join("")+"-"+h.slice(10).join("")}}catch(e){}})();`;
