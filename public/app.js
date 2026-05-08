(() => {
  const POLL_LIVE_MS = 1000;
  const POLL_OFFLINE_MS = 2500;

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
  const GOLDBAR = document.querySelector('.goldbar');
  const MAYHEM_BANNER = document.getElementById('mayhemBanner');

  // 1x1 transparent png so onerror failures don't show a broken-image glyph.
  const BLANK_IMG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

  let ddragonVersion = '14.1.1';
  let seenEventIds = new Set();
  let lastGameTime = -1;
  let online = false;
  let lastOrderKills = 0;
  let lastChaosKills = 0;
  let itemCosts = {};
  const cardByPlayerKey = new Map();

  // Per-team gold-equivalent constants (item value + estimated income).
  // The Live Client API does not expose live gold for non-spectated players,
  // so we approximate from item totals + ARAM's passive gold rate.
  const ARAM_START_GOLD = 500;
  const ARAM_INCOME_PER_SEC = 3.25;

  // ---------- Mayhem modifier registry ----------

  // Casters set the active modifier via ?modifier=<key> on the dashboard URL.
  // Optional ?modifierLabel= / ?modifierSub= override the registry for ad-hoc
  // events. The banner stays hidden when neither the URL nor ARAMMAYHEM mode
  // is detected, so this dashboard is also useful for plain ARAM.
  const MAYHEM_MODIFIERS = {
    urf:        { label: 'URF Mayhem',          sub: '80% CDR · No Mana',          icon: '⚡' },
    spellbook:  { label: 'Ultimate Spellbook',  sub: 'Random Ult Replaces D',      icon: '✨' },
    oneforall:  { label: 'One For All',         sub: 'Mirror Match',               icon: '🪞' },
    ofa:        { label: 'One For All',         sub: 'Mirror Match',               icon: '🪞' },
    lowgrav:    { label: 'Low Gravity',         sub: 'Reduced Gravity',            icon: '🌙' },
    allchaos:   { label: 'All Chaos',           sub: 'Random Effects',             icon: '🎲' },
    arurf:      { label: 'AR URF',              sub: 'All Random URF',             icon: '⚡' },
    aram:       { label: 'Classic ARAM',        sub: 'No Modifier',                icon: '❄' },
    snowball:   { label: 'Snow Day',            sub: 'Snowballs Galore',           icon: '❄' },
    poke:       { label: 'Poke Mayhem',         sub: 'Ranged Buffed',              icon: '🏹' },
    pentakill:  { label: 'Pentakill Hunt',      sub: 'Bonus on Pentas',            icon: '⚔' },
  };

  function resolveModifier() {
    const params = new URLSearchParams(location.search);
    const key = (params.get('modifier') || '').toLowerCase().replace(/[^a-z]/g, '');
    const labelOverride = params.get('modifierLabel');
    const subOverride = params.get('modifierSub');
    if (!key && !labelOverride) return null;
    const base = MAYHEM_MODIFIERS[key] || {
      label: key
        ? key.charAt(0).toUpperCase() + key.slice(1) + ' Mayhem'
        : 'Mayhem',
      sub: 'Modifier Active',
      icon: '⚡',
    };
    return {
      label: labelOverride || base.label,
      sub: subOverride || base.sub,
      icon: base.icon,
    };
  }
  const userModifier = resolveModifier();

  // ---------- DDragon helpers ----------

  // Special cases where the in-game key doesn't match the DDragon asset key.
  // Most champions resolve cleanly via rawChampionName; this is just a safety net.
  const CHAMP_KEY_OVERRIDES = {
    Wukong: 'MonkeyKing',
    Renata: 'Renata',
    Nunu: 'Nunu',
    FiddleSticks: 'Fiddlesticks',
  };

  function championKey(player) {
    const raw = player.rawChampionName || '';
    const m = raw.match(/displayname_([A-Za-z0-9]+)/i);
    if (m) {
      const k = m[1];
      return CHAMP_KEY_OVERRIDES[k] || k;
    }
    // Fallback: strip non-letters from the localized name. Imperfect (Cho'Gath -> ChoGath
    // works, Wukong fails) but rawChampionName is almost always present.
    const stripped = (player.championName || '').replace(/[^A-Za-z]/g, '');
    return CHAMP_KEY_OVERRIDES[stripped] || stripped;
  }

  function ddragonChampion(key) {
    if (!key) return BLANK_IMG;
    return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/champion/${key}.png`;
  }
  function ddragonItem(id) {
    if (!id) return '';
    return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/item/${id}.png`;
  }
  function ddragonSpell(key) {
    if (!key) return BLANK_IMG;
    return `https://ddragon.leagueoflegends.com/cdn/${ddragonVersion}/img/spell/${key}.png`;
  }

  // The Live Client API exposes language-independent identifiers in rawDescription
  // / rawDisplayName, e.g. "GeneratedTip_SummonerSpell_SummonerFlash_Description".
  // Parse those instead of localized displayName so non-English clients still work.
  function spellKey(spell) {
    if (!spell) return '';
    const candidates = [spell.rawDescription, spell.rawDisplayName];
    for (const c of candidates) {
      if (!c) continue;
      const m = c.match(/SummonerSpell[_-]?(Summoner[A-Za-z0-9_]+?)(?:_Description|_DisplayName|$)/);
      if (m) return m[1];
    }
    const dn = (spell.displayName || '').replace(/\s+/g, '');
    if (!dn) return '';
    if (dn.startsWith('Summoner')) return dn;
    return `Summoner${dn}`;
  }

  // ARAM's Mark / Dash snowball summoner. The Live Client API surfaces it under
  // a few names depending on patch (SummonerSnowURFSnowball_Mark, SummonerMark,
  // SummonerSnowball, SummonerSnowURFSnowball), so we sniff multiple fields.
  function isSnowballSpell(spell, key) {
    if (!spell && !key) return false;
    const haystack = [
      key || '',
      spell?.rawDescription || '',
      spell?.rawDisplayName || '',
      spell?.displayName || '',
    ].join(' ').toLowerCase();
    return /snowball|snowurf|summonermark\b|\bmark\b|snow_day/.test(haystack);
  }

  function playerName(p) {
    return (
      p.summonerName ||
      p.riotIdGameName ||
      (p.riotId ? p.riotId.split('#')[0] : '') ||
      p.championName ||
      'Player'
    );
  }

  function playerKey(p) {
    return `${p.team}|${p.summonerName || p.riotIdGameName || p.riotId || p.championName}`;
  }

  // ---------- layout ----------

  function fitStage() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.min(w / 1920, h / 1080);
    STAGE.style.transform = `scale(${scale})`;
    STAGE.style.left = `${(w - 1920 * scale) / 2}px`;
    STAGE.style.top = `${(h - 1080 * scale) / 2}px`;
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  // ---------- formatting ----------

  function fmtClock(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function attachOnError(img, fallback) {
    img.onerror = () => {
      if (img.src !== fallback) img.src = fallback;
    };
  }

  // ---------- card rendering ----------

  function ensureCard(parent, p) {
    const key = playerKey(p);
    let node = cardByPlayerKey.get(key);
    if (!node) {
      node = TPL.content.firstElementChild.cloneNode(true);
      const portrait = node.querySelector('.portrait');
      attachOnError(portrait, BLANK_IMG);
      attachOnError(node.querySelector('.spell-1'), BLANK_IMG);
      attachOnError(node.querySelector('.spell-2'), BLANK_IMG);
      cardByPlayerKey.set(key, node);
    }
    if (node.parentElement !== parent) parent.appendChild(node);
    return node;
  }

  function renderTeam(parent, players, teamKills) {
    const wantedKeys = new Set(players.map(playerKey));
    for (const [key, node] of cardByPlayerKey) {
      if (node.parentElement === parent && !wantedKeys.has(key)) {
        node.remove();
        cardByPlayerKey.delete(key);
      }
    }
    // Append in the order returned by the API so positions are stable.
    for (const p of players) {
      const card = ensureCard(parent, p);
      parent.appendChild(card);
      updateCard(card, p, teamKills);
    }
  }

  function updateCard(card, p, teamKills) {
    const portrait = card.querySelector('.portrait');
    const champUrl = ddragonChampion(championKey(p));
    if (portrait.dataset.url !== champUrl) {
      portrait.dataset.url = champUrl;
      portrait.src = champUrl;
      portrait.alt = p.championName || '';
    }
    card.querySelector('.level-badge').textContent = p.level ?? 1;
    card.querySelector('.summoner-name').textContent = playerName(p);
    card.querySelector('.champion-name').textContent = p.championName || '';

    const spell1Img = card.querySelector('.spell-1');
    const spell2Img = card.querySelector('.spell-2');
    const wrap1 = card.querySelector('.spell-wrap-1');
    const wrap2 = card.querySelector('.spell-wrap-2');
    const k1 = spellKey(p.summonerSpells?.summonerSpellOne);
    const k2 = spellKey(p.summonerSpells?.summonerSpellTwo);
    if (spell1Img.dataset.key !== k1) {
      spell1Img.dataset.key = k1;
      spell1Img.src = ddragonSpell(k1);
      spell1Img.alt = p.summonerSpells?.summonerSpellOne?.displayName || '';
    }
    if (spell2Img.dataset.key !== k2) {
      spell2Img.dataset.key = k2;
      spell2Img.src = ddragonSpell(k2);
      spell2Img.alt = p.summonerSpells?.summonerSpellTwo?.displayName || '';
    }
    wrap1.classList.toggle('is-snowball', isSnowballSpell(p.summonerSpells?.summonerSpellOne, k1));
    wrap2.classList.toggle('is-snowball', isSnowballSpell(p.summonerSpells?.summonerSpellTwo, k2));

    const sc = p.scores || {};
    card.querySelector('.k').textContent = sc.kills ?? 0;
    card.querySelector('.d').textContent = sc.deaths ?? 0;
    card.querySelector('.a').textContent = sc.assists ?? 0;
    card.querySelector('.cs-val').textContent = sc.creepScore ?? 0;
    const w = sc.wardScore ?? 0;
    card.querySelector('.wards-val').textContent = typeof w === 'number' ? w.toFixed(1) : w;

    const slots = card.querySelectorAll('.items .item');
    const items = p.items || [];
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const found = items.find((it) => (it.slot ?? -1) === i);
      const url = found ? ddragonItem(found.itemID) : '';
      if (slot.dataset.url !== url) {
        slot.dataset.url = url;
        slot.style.backgroundImage = url ? `url("${url}")` : '';
      }
      const count = found && typeof found.count === 'number' ? found.count : 0;
      const countEl = slot.querySelector('.item-count');
      if (count > 1) {
        slot.classList.add('has-count');
        countEl.textContent = count;
      } else {
        slot.classList.remove('has-count');
        countEl.textContent = '';
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

    const kills = sc.kills || 0;
    const assists = sc.assists || 0;
    const denom = Math.max(1, teamKills || 0);
    const kp = teamKills > 0 ? Math.min(1, (kills + assists) / denom) : 0;
    const pct = Math.round(kp * 100);
    card.querySelector('.kp-val').textContent = `${pct}%`;
    card.querySelector('.kp-bar-fill').style.width = `${pct}%`;
  }

  // ---------- events ----------

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
      case 'GameStart':
      case 'GameEnd':
      case 'MinionsSpawning':
        return 'start';
      default: return 'objective';
    }
  }

  function isMinionKiller(name) {
    return /^Minion(_|$)/i.test(name || '');
  }
  function isTurretKiller(name) {
    return /^Turret(_|$)/i.test(name || '');
  }

  function prettyKiller(name) {
    if (!name) return 'Unknown';
    if (isMinionKiller(name)) return 'Minions';
    if (isTurretKiller(name)) return parseStructure(name);
    return name;
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

  function describeEvent(e) {
    switch (e.EventName) {
      case 'GameStart': return 'Game started';
      case 'MinionsSpawning': return 'Minions have spawned';
      case 'FirstBlood': return `<strong>${escapeHtml(e.Recipient || '')}</strong> drew first blood`;
      case 'ChampionKill': {
        const killer = prettyKiller(e.KillerName);
        const victim = e.VictimName || '';
        const assists = (e.Assisters || []).filter(Boolean);
        const tail = assists.length ? ` (assist: ${escapeHtml(assists.join(', '))})` : '';
        return `<strong>${escapeHtml(killer)}</strong> killed <strong>${escapeHtml(victim)}</strong>${tail}`;
      }
      case 'Multikill': {
        const map = ['', '', 'Double Kill', 'Triple Kill', 'Quadra Kill', 'PENTAKILL'];
        const label = map[e.KillStreak] || `${e.KillStreak}x Kill`;
        return `<strong>${escapeHtml(prettyKiller(e.KillerName))}</strong> — ${label}`;
      }
      case 'Ace': return `<strong>${escapeHtml(e.AcingTeam || '')}</strong> ACE — ${escapeHtml(e.Acer || '')}`;
      case 'TurretKilled': {
        const t = parseStructure(e.TurretKilled);
        const who = prettyKiller(e.KillerName) || 'Minions';
        return `<strong>${escapeHtml(who)}</strong> destroyed ${escapeHtml(t)}`;
      }
      case 'InhibKilled': {
        const t = parseStructure(e.InhibKilled);
        const who = prettyKiller(e.KillerName) || 'Minions';
        return `<strong>${escapeHtml(who)}</strong> destroyed ${escapeHtml(t)}`;
      }
      case 'InhibRespawningSoon': return `${escapeHtml(parseStructure(e.InhibRespawningSoon))} respawning soon`;
      case 'InhibRespawned': return `${escapeHtml(parseStructure(e.InhibRespawned))} respawned`;
      case 'GameEnd': return `Game ended — ${escapeHtml(e.Result || '')}`;
      default: return escapeHtml(e.EventName || 'Event');
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  function pushEvent(e) {
    if (e.EventID == null || seenEventIds.has(e.EventID)) return;
    seenEventIds.add(e.EventID);
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `
      <div class="feed-time">${fmtClock(e.EventTime)}</div>
      <div class="feed-tag ${tagForEvent(e.EventName)}">${escapeHtml(
      (e.EventName || '').replace(/([A-Z])/g, ' $1').trim()
    )}</div>
      <div class="feed-text">${describeEvent(e)}</div>
    `;
    FEED_LIST.appendChild(row);
    while (FEED_LIST.children.length > 7) FEED_LIST.removeChild(FEED_LIST.firstElementChild);
  }

  function renderInhibs(orderEl, chaosEl, events) {
    const orderInhib = orderEl.querySelector('.inhib');
    const chaosInhib = chaosEl.querySelector('.inhib');
    let orderDead = false, chaosDead = false;
    for (const e of events) {
      if (e.EventName === 'InhibKilled') {
        const raw = e.InhibKilled || '';
        if (raw.includes('_T1_')) orderDead = true;
        if (raw.includes('_T2_')) chaosDead = true;
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

  // ---------- state transitions ----------

  function setKillCount(elId, current, previous) {
    const el = document.getElementById(elId);
    if (el.textContent === String(current)) return;
    el.textContent = current;
    if (current > previous) {
      el.classList.remove('flash');
      // Force a reflow so re-adding the class restarts the animation.
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }

  function setOnline(on) {
    if (on === online) return;
    online = on;
    OFFLINE.hidden = on;
    TOPBAR.hidden = !on;
    TEAMS.hidden = !on;
    FEED.hidden = !on;
    GOLDBAR.hidden = !on;
    if (!on) {
      // Game ended / disconnected: reset for the next game.
      cardByPlayerKey.clear();
      TEAM_ORDER.innerHTML = '';
      TEAM_CHAOS.innerHTML = '';
      FEED_LIST.innerHTML = '';
      seenEventIds = new Set();
      lastGameTime = -1;
      lastOrderKills = 0;
      lastChaosKills = 0;
      MAYHEM_BANNER.hidden = true;
      document.getElementById('orderGoldFill').style.width = '0%';
      document.getElementById('chaosGoldFill').style.width = '0%';
      document.title = 'ARAM Mayhem Dashboard';
    }
  }

  function maybeResetForNewGame(currentGameTime) {
    // Detect a fresh game in the same session (gameTime ticks back toward 0).
    if (lastGameTime > 5 && currentGameTime + 5 < lastGameTime) {
      seenEventIds = new Set();
      FEED_LIST.innerHTML = '';
    }
    lastGameTime = currentGameTime;
  }

  // ---------- Mayhem banner ----------

  function renderMayhemBanner(isMayhemMode) {
    // Casters set the active modifier via ?modifier=. Without that hint we
    // still surface a generic banner whenever ARAMMAYHEM mode is detected.
    const m = userModifier || (isMayhemMode
      ? { label: 'Mayhem', sub: 'Modifier Active', icon: '⚡' }
      : null);
    if (!m) {
      MAYHEM_BANNER.hidden = true;
      return;
    }
    MAYHEM_BANNER.hidden = false;
    const labelEl = document.getElementById('mayhemLabel');
    const subEl = document.getElementById('mayhemSub');
    const iconEl = MAYHEM_BANNER.querySelector('.mayhem-icon');
    if (labelEl.textContent !== m.label) labelEl.textContent = m.label;
    if (subEl.textContent !== m.sub) subEl.textContent = m.sub;
    if (iconEl.textContent !== m.icon) iconEl.textContent = m.icon;
  }

  // ---------- Team gold ----------

  function teamGold(players, gameTime) {
    let g = 0;
    for (const p of players) {
      g += ARAM_START_GOLD;
      const items = p.items || [];
      for (const it of items) {
        const cost = itemCosts[String(it.itemID)] || 0;
        const count = typeof it.count === 'number' ? it.count : 1;
        g += cost * count;
      }
    }
    g += players.length * Math.max(0, gameTime || 0) * ARAM_INCOME_PER_SEC;
    return Math.round(g);
  }

  function fmtGold(n) {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }

  function renderGoldBar(orderGold, chaosGold) {
    GOLDBAR.hidden = false;
    document.getElementById('orderGold').textContent = fmtGold(orderGold);
    document.getElementById('chaosGold').textContent = fmtGold(chaosGold);
    const max = Math.max(1, orderGold, chaosGold);
    document.getElementById('orderGoldFill').style.width = `${(orderGold / max) * 100}%`;
    document.getElementById('chaosGoldFill').style.width = `${(chaosGold / max) * 100}%`;
    const diff = orderGold - chaosGold;
    const orderDelta = document.getElementById('orderGoldDelta');
    const chaosDelta = document.getElementById('chaosGoldDelta');
    if (diff > 0) {
      orderDelta.textContent = `+${fmtGold(diff)}`;
      orderDelta.className = 'goldbar-delta up';
      chaosDelta.textContent = '';
      chaosDelta.className = 'goldbar-delta';
    } else if (diff < 0) {
      chaosDelta.textContent = `+${fmtGold(-diff)}`;
      chaosDelta.className = 'goldbar-delta up';
      orderDelta.textContent = '';
      orderDelta.className = 'goldbar-delta';
    } else {
      orderDelta.textContent = '';
      chaosDelta.textContent = '';
      orderDelta.className = chaosDelta.className = 'goldbar-delta';
    }
  }

  // ---------- main loop ----------

  function render(data) {
    const gd = data.gameData || {};
    const t = gd.gameTime || 0;
    maybeResetForNewGame(t);

    document.getElementById('gameClock').textContent = fmtClock(t);

    const mode = (gd.gameMode || '').toUpperCase();
    const isAram = mode === 'ARAM' || mode === 'ARAMMAYHEM' || gd.mapNumber === 12 || gd.mapNumber === 14;
    const isMayhem = mode === 'ARAMMAYHEM';
    MODE_LINE.textContent = isAram
      ? gd.mapNumber === 14
        ? "Butcher's Bridge — Mayhem"
        : 'Howling Abyss — Mayhem'
      : `${gd.gameMode || 'Live'} — ${gd.mapName || ''}`;

    renderMayhemBanner(isMayhem);

    const players = Array.isArray(data.allPlayers) ? data.allPlayers : [];
    const order = players.filter((p) => p.team === 'ORDER');
    const chaos = players.filter((p) => p.team === 'CHAOS');

    let orderKills = 0, chaosKills = 0;
    for (const p of order) orderKills += p.scores?.kills || 0;
    for (const p of chaos) chaosKills += p.scores?.kills || 0;
    setKillCount('orderKills', orderKills, lastOrderKills);
    setKillCount('chaosKills', chaosKills, lastChaosKills);
    lastOrderKills = orderKills;
    lastChaosKills = chaosKills;

    renderTeam(TEAM_ORDER, order, orderKills);
    renderTeam(TEAM_CHAOS, chaos, chaosKills);

    const orderGold = teamGold(order, t);
    const chaosGold = teamGold(chaos, t);
    renderGoldBar(orderGold, chaosGold);

    const events = data.events?.Events || [];
    renderInhibs(
      document.getElementById('orderInhibs'),
      document.getElementById('chaosInhibs'),
      events
    );
    for (const e of events) pushEvent(e);

    document.title = `${fmtClock(t)} · ${orderKills}–${chaosKills} · ARAM Mayhem`;
  }

  let pollTimer = null;
  let inFlight = false;

  async function tick() {
    if (inFlight) return;
    inFlight = true;
    try {
      const r = await fetch('/api/allgamedata', { cache: 'no-store' });
      if (!r.ok) throw new Error(`status ${r.status}`);
      const data = await r.json();
      render(data);
      setOnline(true);
    } catch {
      setOnline(false);
    } finally {
      inFlight = false;
      schedule();
    }
  }

  function schedule() {
    if (pollTimer) clearTimeout(pollTimer);
    if (document.visibilityState === 'hidden') {
      pollTimer = null; // resume on visibility change
      return;
    }
    const delay = online ? POLL_LIVE_MS : POLL_OFFLINE_MS;
    pollTimer = setTimeout(tick, delay);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
  });

  async function fetchVersion() {
    try {
      const r = await fetch('/api/version');
      const j = await r.json();
      if (j && j.version) ddragonVersion = j.version;
    } catch {}
  }

  async function fetchItemCosts() {
    try {
      const r = await fetch('/api/itemcosts');
      const j = await r.json();
      if (j && j.costs) itemCosts = j.costs;
    } catch {}
  }

  (async function main() {
    await Promise.all([fetchVersion(), fetchItemCosts()]);
    setInterval(fetchVersion, 60 * 60 * 1000);
    setInterval(fetchItemCosts, 60 * 60 * 1000);
    tick();
  })();
})();
