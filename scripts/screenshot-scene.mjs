// Marketing scenery only: the iframe renders the unchanged ByBots application.
export function desktopScene(baseUrl, kind) {
  const team = kind === "team";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>ByBots desktop preview</title>
  <style>
    *{box-sizing:border-box}html,body{margin:0;width:1600px;height:1120px;overflow:hidden;font-family:'Segoe UI Variable Text','Segoe UI',sans-serif;color:#fff}
    body{background:#222350}.wallpaper{position:absolute;inset:0;width:100%;height:100%}
    .brand{position:absolute;left:100px;top:38px;display:flex;align-items:center;gap:12px;font-size:23px;font-weight:650;letter-spacing:-.6px}
    .brand img{width:36px;height:36px;border-radius:9px}.edition{position:absolute;right:100px;top:50px;font-size:13px;letter-spacing:2.3px;text-transform:uppercase;opacity:.8}
    h1{position:absolute;top:91px;left:100px;margin:0;font-size:66px;font-weight:650;letter-spacing:-3px;line-height:1.15;text-shadow:0 2px 28px #15133830}
    .subtitle{position:absolute;top:177px;left:103px;font-size:21px;margin:0;color:#ffffffdb;letter-spacing:-.2px}
    .window{position:absolute;left:100px;top:249px;width:1400px;height:777px;border-radius:14px;overflow:hidden;border:1px solid #ffffff63;box-shadow:0 48px 100px #080a3d80,0 8px 20px #080a3d60;background:#101012}
    iframe{display:block;width:100%;height:100%;border:0}
    .taskbar{position:absolute;bottom:0;width:100%;height:56px;background:#171a3c88;border-top:1px solid #ffffff24;backdrop-filter:blur(28px);display:flex;align-items:center;justify-content:center;gap:22px}
    .start{display:grid;grid-template-columns:repeat(2,10px);gap:3px}.start i{width:10px;height:10px;background:#b9d8ff;border-radius:1px}
    .search{width:170px;padding:8px 14px;border:1px solid #ffffff27;background:#ffffff10;border-radius:20px;font-size:13px;color:#efeff5}
    .taskbar img{width:31px;height:31px;border-radius:8px}.active{position:relative}.active:after{content:'';position:absolute;bottom:-6px;left:9px;right:9px;height:3px;background:#a8e3f4;border-radius:3px}
    .clock{position:absolute;right:30px;font-size:12px;line-height:17px;text-align:right;color:#eff0f8}.caption{position:absolute;left:30px;font-size:12px;color:#e4e4f2}
  </style>
  <svg class="wallpaper" viewBox="0 0 1600 1120" preserveAspectRatio="none" aria-hidden="true"><defs>
    <linearGradient id="sky" x2=".9" y2="1"><stop stop-color="${team ? '#154b69' : '#674992'}"/><stop offset=".5" stop-color="${team ? '#376d92' : '#4b509b'}"/><stop offset="1" stop-color="#171d49"/></linearGradient>
    <linearGradient id="silk" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${team ? '#80d9cf' : '#ffd3af'}"/><stop offset=".42" stop-color="${team ? '#54a8b7' : '#d597b0'}"/><stop offset="1" stop-color="${team ? '#355b8f' : '#6d6cc0'}"/></linearGradient>
    <linearGradient id="ridge" x2="1" y2=".5"><stop stop-color="#172653"/><stop offset=".55" stop-color="${team ? '#3b9eaf' : '#8c79c5'}"/><stop offset="1" stop-color="${team ? '#8bd5cb' : '#f9c3b2'}"/></linearGradient>
  </defs><rect width="1600" height="1120" fill="url(#sky)"/>
  <path d="M650 -200 C1500 -130 860 490 1670 465 L1720 -200Z" fill="url(#silk)"/>
  <path d="M-180 430 C440 730 70 930 770 1240 L-180 1270Z" fill="url(#ridge)"/>
  <path d="M-100 480 C395 745 67 1000 850 1260" fill="none" stroke="#d8ccef" stroke-opacity=".25" stroke-width="2"/>
  <path d="M698 -120 C1455 -72 910 455 1620 483" fill="none" stroke="#ffe9dc" stroke-opacity=".45" stroke-width="2"/></svg>
  <div class="brand"><img src="${baseUrl}/icons/icon-192.png" alt="">ByBots</div><div class="edition">Your Hermes workspace</div>
  <h1>${team ? 'One conversation. A whole AI team.' : 'Big ideas. Real output.'}</h1>
  <p class="subtitle">${team ? 'Bring specialized Bots together. Move work forward.' : 'Meet your Bots. Shape the plan. Leave with something useful.'}</p>
  <div class="window"><iframe title="ByBots Windows application" src="${baseUrl}/?desktop=windows"></iframe></div>
  <div class="taskbar"><span class="caption">Desktop preview · Demo workspace</span><div class="start"><i></i><i></i><i></i><i></i></div><div class="search">⌕ &nbsp; Search</div><div class="active"><img src="${baseUrl}/icons/icon-192.png" alt="ByBots running"></div><div class="clock">9:41 AM<br>Sep 4, 2026</div></div>
  </html>`;
}
