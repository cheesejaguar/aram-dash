(() => {
  const POLL_MS = 1000;
  const STAGE = document.getElementById('stage');
  const OFFLINE = document.getElementById('offline');
  const TOPBAR = document.querySelector('.topbar');
  const TEAMS = document.querySelector('.teams');
  const FEED = document.querySelector('.feed');
  const TEAM_ORDER = document.getElementById('teamOrder');
  const TEAM_CHAOS = document.getElementById('teamChaos');
  const TPL = document.getElementById('playerCardTpl');
  const FEED_LIST = document.getElementById('eventFeed');
  const MODE_LINE = document.getElementById('modeLine');

  let ddragonVersion = '14.1.1';
  const seenEventIds = new Set();
  const cardByPlayerKey = new Map();

  function fitStage() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(w / 1920, h / 1080);
    STAGE.style.transform = `scale(${scale})`;
    STAGE.style.left = `${(w - 1920 * scale) / 2}px`;
    STAGE.style.top = `${(h - 1080 * scale) / 2}px`;
    STAGE.style.position = 'absolute';
    document.body.style.background = '#000';
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  async function fetchVersion() {
    try {
      const r = await fetch('/api/version');
      const j = await r.json();
      if (j && j.version) ddragonVersion = j.version;
    } catch {}
  }

  function ddragonChampion(name) {
    if (!name) return '';
    const safe = name.replace(/[^A-Za-z]/g, '');
    return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${safe}.png`;
  }
  function ddragonItem(id) {
    if (!id) return '';
    return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`;
  }
  function ddragonSpell(name) {
    if (!name) return '';
    const map = {
      SummonerFlash: 'SummonerFlash',
      SummonerHeal: 'SummonerHeal',
      SummonerExhaust: 'SummonerExhaust',
      SummonerBarrier: 'SummonerBarrier',
      SummonerBoost: 'SummonerBoost',
      SummonerHaste: 'SummonerHaste',
      SummonerMana: 'SummonerMana',
      SummonerDot: 'SummonerDot',
      SummonerTeleport: 'SummonerTeleport',
      SummonerSnowball: 'SummonerSnowball',
      SummonerSnowURFSnowball_Mark: 'SummonerSnowURFSnowball_Mark',
      SummonerSmite: 'SummonerSmite',
      SummonerClairvoyance: 'SummonerClairvoyance',
    };
    const key = map[name] || name;
    return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${key}.png`;
  }

  function fmtClock(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function playerKey(p) {
    return `${p.team}|${p.summonerName || p.riotId || p.championName}`;
  }

  function ensureCard(parent, p) {
    const key = playerKey(p);
    if (cardByPlayerKey.has(key)) return cardByPlayerKey.get(key);
    const node = TPL.content.firstElementChild.cloneNode(true);
    parent.appendChild(node);
    cardByPlayerKey.set(key, node);
    return node;
  }

  function renderTeam(parent, players) {
    const wantedKeys = new Set(players.map(playerKey));
    for (const [key, node] of cardByPlayerKey) {
      if (node.parentElement === parent && !wantedKeys.has(key)) {
        node.remove();
        cardByPlayerKey.delete(key);
      }
    }
    parent.innerHTML = '';
    for (const p of players) {
      const card = ensureCard(parent, p);
      parent.appendChild(card);
      updateCard(card, p);
    }
  }

  function updateCard(card, p) {
    const portrait = card.querySelector('.portrait');
    const champSrc = ddragonChampion(p.championName || p.rawChampionName);
    if (portrait.dataset.src !== champSrc) {
      portrait.dataset.src = champSrc;
      portrait.src = champSrc;
      portrait.alt = p.championName || '';
    }
    card.querySelector('.level-badge').textContent = p.level ?? 1;
    card.querySelector('.summoner-name').textContent = p.summonerName || (p.riotId || '').split('#')[0] || '';
    card.querySelector('.champion-name').textContent = p.championName || '';

    const s1 = p.summonerSpells?.summonerSpellOne?.rawDescription
      ? p.summonerSpells.summonerSpellOne.displayName
      : p.summonerSpells?.summonerSpellOne?.displayName;
    const s2 = p.summonerSpells?.summonerSpellTwo?.displayName;
    const spell1Img = card.querySelector('.spell-1');
    const spell2Img = card.querySelector('.spell-2');
    const sn1 = displayNameToSpellKey(s1);
    const sn2 = displayNameToSpellKey(s2);
    if (spell1Img.dataset.key !== sn1) {
      spell1Img.dataset.key = sn1;
      spell1Img.src = ddragonSpell(sn1);
      spell1Img.alt = s1 || '';
    }
    if (spell2Img.dataset.key !== sn2) {
      spell2Img.dataset.key = sn2;
      spell2Img.src = ddragonSpell(sn2);
      spell2Img.alt = s2 || '';
    }

    const sc = p.scores || {};
    card.querySelector('.k').textContent = sc.kills ?? 0;
    card.querySelector('.d').textContent = sc.deaths ?? 0;
    card.querySelector('.a').textContent = sc.assists ?? 0;
    card.querySelector('.cs-val').textContent = sc.creepScore ?? 0;
    const w = sc.wardScore ?? 0;
    card.querySelector('.wards-val').textContent = (typeof w === 'number' ? w.toFixed(1) : w);

    const slots = card.querySelectorAll('.items .item');
    const items = (p.items || []).slice();
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const found = items.find((it) => (it.slot ?? -1) === i);
      const url = found ? ddragonItem(found.itemID) : '';
      if (slot.dataset.url !== url) {
        slot.dataset.url = url;
        slot.style.backgroundImage = url ? `url("${url}")` : '';
      }
    }

    const death = card.querySelector('.death-overlay');
    if (p.isDead && (p.respawnTimer || 0) > 0.5) {
      card.classList.add('dead');
      death.hidden = false;
      death.querySelector('.death-time').textContent = `${Math.ceil(p.respawnTimer)}s`;
    } else {
      card.classList.remove('dead');
      death.hidden = true;
    }
  }

  function displayNameToSpellKey(name) {
    if (!name) return '';
    const m = {
      Flash: 'SummonerFlash',
      Heal: 'SummonerHeal',
      Exhaust: 'SummonerExhaust',
      Barrier: 'SummonerBarrier',
      Ghost: 'SummonerHaste',
      Cleanse: 'SummonerBoost',
      Clarity: 'SummonerMana',
      Ignite: 'SummonerDot',
      Teleport: 'SummonerTeleport',
      Mark: 'SummonerSnowball',
      Snowball: 'SummonerSnowball',
      'Mark/Dash': 'SummonerSnowball',
      Smite: 'SummonerSmite',
    };
    return m[name] || `Summoner${name.replace(/\s+/g, '')}`;
  }

  function tagForEvent(name) {
    switch (name) {
      case 'ChampionKill': return 'kill';
      case 'Multikill': return 'multi';
      case 'Ace': return 'ace';
      case 'TurretKilled': return 'turret';
      case 'InhibKilled':
      case 'InhibRespawningSoon':
      case 'InhibRespawned':
        return 'inhib';
      case 'FirstBlood': return 'first';
      case 'GameStart': return 'start';
      case 'GameEnd': return 'end';
      case 'MinionsSpawning': return 'minions';
      default: return 'objective';
    }
  }

  function describeEvent(e) {
    switch (e.EventName) {
      case 'GameStart': return 'Game started';
      case 'MinionsSpawning': return 'Minions have spawned';
      case 'FirstBlood': return `<strong>${e.Recipient || ''}</strong> drew first blood`;
      case 'ChampionKill': {
        const killer = e.KillerName || 'Minion';
        const victim = e.VictimName || '';
        const assists = (e.Assisters || []).filter(Boolean);
        const tail = assists.length ? ` (assist: ${assists.join(', ')})` : '';
        return `<strong>${killer}</strong> killed <strong>${victim}</strong>${tail}`;
      }
      case 'Multikill': {
        const map = ['', '', 'Double Kill', 'Triple Kill', 'Quadra Kill', 'Penta Kill'];
        const label = map[e.KillStreak] || `${e.KillStreak}x Kill`;
        return `<strong>${e.KillerName}</strong> — ${label}`;
      }
      case 'Ace': return `<strong>${e.AcingTeam}</strong> ACE — ${e.Acer || ''}`;
      case 'TurretKilled': {
        const t = parseStructure(e.TurretKilled);
        const who = e.KillerName || 'Minions';
        return `<strong>${who}</strong> destroyed ${t}`;
      }
      case 'InhibKilled': {
        const t = parseStructure(e.InhibKilled);
        const who = e.KillerName || 'Minions';
        return `<strong>${who}</strong> destroyed ${t}`;
      }
      case 'InhibRespawningSoon': return `${parseStructure(e.InhibRespawningSoon)} respawning soon`;
      case 'InhibRespawned': return `${parseStructure(e.InhibRespawned)} respawned`;
      case 'GameEnd': return `Game ended — ${e.Result || ''}`;
      default: return e.EventName || 'Event';
    }
  }

  function parseStructure(raw) {
    if (!raw) return 'structure';
    if (raw.startsWith('Turret_')) {
      const side = raw.includes('_T1_') ? 'Order' : raw.includes('_T2_') ? 'Chaos' : '';
      return `${side} turret`.trim();
    }
    if (raw.startsWith('Barracks_')) {
      const side = raw.includes('_T1_') ? 'Order' : raw.includes('_T2_') ? 'Chaos' : '';
      return `${side} inhibitor`.trim();
    }
    return raw;
  }

  function pushEvent(e) {
    if (seenEventIds.has(e.EventID)) return;
    seenEventIds.add(e.EventID);
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `
      <div class="feed-time">${fmtClock(e.EventTime)}</div>
      <div class="feed-tag ${tagForEvent(e.EventName)}">${e.EventName.replace(/([A-Z])/g, ' $1').trim()}</div>
      <div class="feed-text">${describeEvent(e)}</div>
    `;
    FEED_LIST.appendChild(row);
    while (FEED_LIST.children.length > 7) FEED_LIST.removeChild(FEED_LIST.firstElementChild);
  }

  function renderInhibs(orderEl, chaosEl, events) {
    // ARAM has 1 inhibitor per side (single lane).
    const orderInhib = orderEl.querySelector('.inhib');
    const chaosInhib = chaosEl.querySelector('.inhib');
    let orderDead = false, chaosDead = false;
    let orderRespawnAt = 0, chaosRespawnAt = 0;
    for (const e of events) {
      if (e.EventName === 'InhibKilled') {
        const raw = e.InhibKilled || '';
        if (raw.includes('_T1_')) { orderDead = true; orderRespawnAt = (e.EventTime || 0) + 240; }
        if (raw.includes('_T2_')) { chaosDead = true; chaosRespawnAt = (e.EventTime || 0) + 240; }
      } else if (e.EventName === 'InhibRespawned') {
        const raw = e.InhibRespawned || '';
        if (raw.includes('_T1_')) orderDead = false;
        if (raw.includes('_T2_')) chaosDead = false;
      }
    }
    orderInhib.classList.toggle('alive', !orderDead);
    orderInhib.classList.toggle('dead', orderDead);
    chaosInhib.classList.toggle('alive', !chaosDead);
    chaosInhib.classList.toggle('dead', chaosDead);
  }

  function setOnline(on) {
    OFFLINE.hidden = on;
    TOPBAR.hidden = !on;
    TEAMS.hidden = !on;
    FEED.hidden = !on;
  }

  async function tick() {
    try {
      const r = await fetch('/api/allgamedata', { cache: 'no-store' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const data = await r.json();
      render(data);
      setOnline(true);
    } catch {
      setOnline(false);
      cardByPlayerKey.clear();
      TEAM_ORDER.innerHTML = '';
      TEAM_CHAOS.innerHTML = '';
    }
  }

  function render(data) {
    const gd = data.gameData || {};
    document.getElementById('gameClock').textContent = fmtClock(gd.gameTime || 0);

    const mode = (gd.gameMode || '').toUpperCase();
    const isAram = mode === 'ARAM' || mode === 'ARAMMAYHEM' || (gd.mapNumber === 12 || gd.mapNumber === 14);
    MODE_LINE.textContent = isAram
      ? (gd.mapNumber === 14 ? "Butcher's Bridge — Mayhem" : 'Howling Abyss — Mayhem')
      : `${gd.gameMode || 'Live'} — ${gd.mapName || ''}`;

    const players = Array.isArray(data.allPlayers) ? data.allPlayers : [];
    const order = players.filter((p) => p.team === 'ORDER');
    const chaos = players.filter((p) => p.team === 'CHAOS');

    let orderKills = 0, chaosKills = 0;
    for (const p of order) orderKills += p.scores?.kills || 0;
    for (const p of chaos) chaosKills += p.scores?.kills || 0;
    document.getElementById('orderKills').textContent = orderKills;
    document.getElementById('chaosKills').textContent = chaosKills;

    renderTeam(TEAM_ORDER, order);
    renderTeam(TEAM_CHAOS, chaos);

    const events = data.events?.Events || [];
    renderInhibs(
      document.getElementById('orderInhibs'),
      document.getElementById('chaosInhibs'),
      events
    );
    for (const e of events) pushEvent(e);
  }

  (async function main() {
    await fetchVersion();
    setInterval(fetchVersion, 60 * 60 * 1000);
    tick();
    setInterval(tick, POLL_MS);
  })();
})();
