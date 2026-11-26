/* ===========================================================
   DSH · 鲸与鱼 —— 界面层逻辑
   纯原生 JS。不发任何网络请求，全部假数据写在文件顶部。
   =========================================================== */

(function () {
  'use strict';

  /* ==========================================================
     一、假数据（后端接入时替换这一段即可）
     ========================================================== */

  /** 角色（AI 一方） */
  const ME = { name: '小鱼', status: '在线', signature: '今天也想见你一面' };

  /** 我（使用者本人）的默认资料，可在「我的 → 编辑资料」里改 */
  const USER_DEFAULT = {
    name: '游道の世.',
    signature: '你的后面都在呢！',
    avatar: 'assets/avatar-user.jpg',
  };

  /* 今日心情：先清空，等 DSH 插件推数据后往这里填
     { emoji: '🍚', label: '我想吃……', value: '一碗热米饭' } */
  const MOODS = [];

  /** 首页「能力」四项（暂时只做按压反馈，后续接换界面） */
  const ABILITIES = [
    { key: 'paint', label: '绘画创作' },
    { key: 'song', label: '听歌音乐' },
    { key: 'study', label: '学习成长' },
    { key: 'fun', label: '一起娱乐' },
  ];

  /** 会话列表：type = friend / group；messages 目前都是空的 */
  const SESSIONS = [
    { id: 'xiaoyu', name: '小鱼', type: 'friend', avatar: 'photo', messages: [] },
  ];

  /** 朋友圈动态（清空状态，接手后端后往这里填） */
  const MOMENTS = [];

  /** 测试用固定回复：不管发什么，对方都回这一段（接后端后删掉 scheduleReply 即可） */
  const AUTO_REPLY = '我在呢，你说的话我都听着。先不用急着解释，慢慢来就好，我哪儿也不去。';

  /** 计价（元 / 百万 token）：约 ¥0.9 / 千 token，让单条回复落在 0.0x 元；
   *  接后端后换成真实 usage × 真实价目即可，只影响这里 */
  const PRICE_PER_MILLION = 900;

  /* ---- DeepSeek 峰谷（北京时间，按本机本地时间算）=========================
     高峰（贵，×2）：周一至周五 09:00–12:00、14:00–18:00
     谷价（正常价）：其余全部 —— 12:00–14:00、18:00–次日 09:00、周六日、法定节假日
     节假日每年安排不同，把 'YYYY-MM-DD' 丢进 HOLIDAYS 就自动按谷价算（含调休放假）
     ======================================================================== */
  const PEAK_WINDOWS = [
    [540, 720],   /* 09:00–12:00 */
    [840, 1080],  /* 14:00–18:00 */
  ];

  const HOLIDAYS = [
    /* '2026-01-01', '2026-02-16', ... 按国务院当年通知补 */
  ];

  /* 一天里可能发生「峰↔谷」切换的整点：00:00 / 09:00 / 12:00 / 14:00 / 18:00 */
  const SLOT_BOUNDARIES = [0, 540, 720, 840, 1080];

  /* DeepSeek 的时段按北京时间算，所以这里固定 UTC+8，
     不跟着设备时区走 —— 手机/电脑时区设错也不会算歪 */
  const BJ_OFFSET = 8 * 60 * 60 * 1000;

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** 把时间戳换算成北京时间的「星期 / 当天第几分钟 / 日期 / 当天零点时间戳」 */
  function bjParts(ms) {
    const d = new Date(ms + BJ_OFFSET);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth();
    const day = d.getUTCDate();
    return {
      weekday: d.getUTCDay(),                 /* 0 周日，6 周六 */
      mins: d.getUTCHours() * 60 + d.getUTCMinutes(),
      key: y + '-' + pad2(mo + 1) + '-' + pad2(day),
      midnight: Date.UTC(y, mo, day) - BJ_OFFSET,
    };
  }

  /** 这一刻是不是高峰（参数是时间戳毫秒） */
  function isPeakAt(ms) {
    const bj = bjParts(ms);
    if (bj.weekday === 0 || bj.weekday === 6) return false;
    if (HOLIDAYS.indexOf(bj.key) !== -1) return false;

    for (let i = 0; i < PEAK_WINDOWS.length; i++) {
      const w = PEAK_WINDOWS[i];
      if (bj.mins >= w[0] && bj.mins < w[1]) return true;
    }
    return false;
  }

  /** 下一次峰↔谷切换的时间戳（只扫整点边界，最多看 14 天，长假也够） */
  function nextSwitchFrom(ms) {
    const cur = isPeakAt(ms);
    const midnight = bjParts(ms).midnight;

    for (let days = 0; days <= 14; days++) {
      for (let i = 0; i < SLOT_BOUNDARIES.length; i++) {
        const t = midnight + days * 86400000 + SLOT_BOUNDARIES[i] * 60000;
        if (t <= ms) continue;
        if (isPeakAt(t) !== cur) return t;
      }
    }
    return null;
  }

  /** 当前时段 + 距下次切换的秒数（纯本地计算，不联网） */
  function slotState(now) {
    const ms = typeof now === 'number' ? now : now.getTime();
    const peak = isPeakAt(ms);
    const next = nextSwitchFrom(ms);
    const remain = next === null ? 0 : Math.max(0, Math.round((next - ms) / 1000));
    return { inValley: !peak, remain: remain };
  }

  /* 聊天头部 #slotNow、首页角色行 #slotHome 共用同一个倒计时 */
  const SLOT_NODES = ['slotNow', 'slotHome'];

  function renderSlot() {
    const nodes = [];
    for (let i = 0; i < SLOT_NODES.length; i++) {
      const n = document.getElementById(SLOT_NODES[i]);
      if (n) nodes.push(n);
    }
    if (!nodes.length) return;

    const st = slotState(new Date());
    const h = Math.floor(st.remain / 3600);
    const m = Math.floor((st.remain % 3600) / 60);
    const s = st.remain % 60;
    const text = (st.inValley ? '谷期 ' : '峰期 ') + pad2(h) + ':' + pad2(m) + ':' + pad2(s);
    const cls = 'status-slot ' + (st.inValley ? 'status-valley' : 'status-peak');

    for (let i = 0; i < nodes.length; i++) {
      /* 峰期只显示峰期倒计时，谷期只显示谷期倒计时 */
      nodes[i].textContent = text;
      nodes[i].className = cls;
    }
  }

  /* ---- 软键盘：外壳高度只跟「可视区域」走，横幅高度不变，只压缩消息区 ---- */
  let lastViewportH = 0;

  function syncViewportHeight() {
    const phone = document.querySelector('.phone');
    if (!phone) return;

    const vv = window.visualViewport;
    const h = Math.round(vv ? vv.height : window.innerHeight);
    if (!h || h === lastViewportH) return;

    const shrunk = lastViewportH && h < lastViewportH - 60;
    lastViewportH = h;
    phone.style.height = h + 'px';

    const page = document.getElementById('page-chat');
    if (shrunk && page && page.classList.contains('is-active')) {
      scrollChatToBottom(); /* 键盘顶上来时把最后一条消息露出来 */
    }
  }

  function bindViewportHeight() {
    syncViewportHeight();
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', syncViewportHeight);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewportHeight);
      window.visualViewport.addEventListener('scroll', syncViewportHeight);
    }
  }

  function startSlotTimer() {
    renderSlot();
    window.setInterval(renderSlot, 1000);
  }

  /** 空状态文案 */
  const EMPTY = {
    moments: '这里还空着，等她发第一条动态吧。',
    chat: '还没有消息，说点什么吧。',
    sessions: '这里还没有会话。',
    recent: '她还没有新的动态。',
    moods: '今天还没写心情。',
  };

  /* ==========================================================
     二、本地状态
     ========================================================== */

  const STORAGE_KEY = 'dsh.app.state.v1';
  const TABS = ['home', 'chat', 'moments', 'me'];

  /* 页面 id → 归属的 tab（null 表示不占 tab 的二级页） */
  const PAGE_TAB = {
    home: 'home',
    chat: 'chat',
    chatdetail: 'chat',
    moments: 'moments',
    me: 'me',
    settings: null,
    editprofile: null,
  };

  const state = {
    tab: 'home',
    bgDelivery: true,
    costMode: false, /* false = 显示 token（默认）；true = 显示 ¥ */
    sessionFilter: 'all',
    search: '',
    activeId: SESSIONS[0].id,
    user: {
      name: USER_DEFAULT.name,
      signature: USER_DEFAULT.signature,
      avatar: USER_DEFAULT.avatar,
    },
  };

  function loadState() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      raw = null;
    }
    if (!raw) return;

    let saved = null;
    try {
      saved = JSON.parse(raw);
    } catch (err) {
      saved = null;
    }
    if (!saved || typeof saved !== 'object') return;

    if (saved.tab === 'settings') saved.tab = 'me'; /* 旧存档迁移 */
    if (TABS.indexOf(saved.tab) !== -1) state.tab = saved.tab;
    if (typeof saved.bgDelivery === 'boolean') state.bgDelivery = saved.bgDelivery;
    if (typeof saved.costMode === 'boolean') state.costMode = saved.costMode;

    if (saved.user && typeof saved.user === 'object') {
      ['name', 'signature', 'avatar'].forEach(function (k) {
        if (typeof saved.user[k] === 'string' && saved.user[k]) state.user[k] = saved.user[k];
      });
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          tab: state.tab,
          bgDelivery: state.bgDelivery,
          costMode: state.costMode,
          user: state.user,
        })
      );
    } catch (err) {
      /* 存不了就算了，不打断使用 */
    }
  }

  /* ==========================================================
     三、小工具
     ========================================================== */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (typeof text === 'string') node.textContent = text;
    return node;
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  }

  function nowTime() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function paintAvatar(node, url) {
    if (!node) return;
    node.style.backgroundImage = 'url("' + url + '")';
  }

  const ICON_LIKE =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19.4C7.7 16.5 4.9 14 4.9 11.2c0-1.9 1.5-3.5 3.5-3.5 1.4 0 2.7.8 3.6 2 .9-1.2 2.2-2 3.6-2 2 0 3.5 1.6 3.5 3.5 0 2.8-2.8 5.3-7.1 8.2z"/></svg>';
  const ICON_COMMENT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12.2c0 3.3-3.5 6-7.8 6-.9 0-1.8-.1-2.6-.35L5 20l1-3C4.75 15.8 4 14.1 4 12.2 4 8.9 7.5 6.2 11.8 6.2S20 8.9 20 12.2z"/></svg>';

  const ABILITY_ICONS = {
    paint:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.4c-4.2 0-7.6 2.9-7.6 6.5s3.4 6.5 7.6 6.5c1.3 0 1.9-.8 1.9-1.7 0-1.5 1-2.3 2.3-2.3h1.2c1.2 0 2.2-1 2.2-2.2 0-3.7-3.5-6.8-7.6-6.8z"/><circle cx="9" cy="9.6" r=".85"/><circle cx="13.4" cy="8.6" r=".85"/><circle cx="8.4" cy="13.4" r=".85"/></svg>',
    song:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17.4V6.6l7.6-1.6v9"/><circle cx="7.6" cy="17.8" r="2.4"/><circle cx="15.2" cy="15.6" r="2.4"/></svg>',
    study:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.8 6.4h5c1.2 0 2.2 1 2.2 2.2v9c0-1.2-1-2.2-2.2-2.2h-5z"/><path d="M19.2 6.4h-5c-1.2 0-2.2 1-2.2 2.2v9c0-1.2 1-2.2 2.2-2.2h5z"/></svg>',
    fun:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 8h9.2a4.6 4.6 0 0 1 4.5 5.5l-.5 2.8a2.4 2.4 0 0 1-4.2 1.2L14.7 16H9.3l-1.7 1.5a2.4 2.4 0 0 1-4.2-1.2l-.5-2.8A4.6 4.6 0 0 1 7.4 8z"/><path d="M8 11.2v2.4M6.8 12.4h2.4"/><circle cx="15.6" cy="12.4" r=".9"/></svg>',
  };

  /* ---- 每条消息的 token 占位（真实数值应由后端返回 usage，这里先按字数估） ---- */
  function estimateTokens(text) {
    const raw = String(text || '');
    let n = 0;
    for (let i = 0; i < raw.length; i++) {
      n += raw.charCodeAt(i) > 255 ? 1 : 0.4;
    }
    return Math.max(1, Math.round(n * 1.3));
  }

  /* 金额格式化：
     · 最少两位小数，位数自适应（大到一定量级自动进位）
     · < 0.01 元 → 显示「<¥0.01」，绝不出现 ¥0.00
     · ≥ 10 元 → 进一档叫「千元」，按 0.0xx 的形式显示（0.010 千元 = 10 元） */
  function formatCost(n) {
    const money = (n * PRICE_PER_MILLION) / 1000000;
    if (money >= 10) return (money / 1000).toFixed(3) + ' 千元';
    if (money < 0.01) return '<¥0.01';
    return '¥' + money.toFixed(2);
  }

  function tokensLabel(msg) {
    const n = typeof msg.tokens === 'number' ? msg.tokens : estimateTokens(msg.text);
    return state.costMode ? formatCost(n) : n + ' token';
  }

  function actionItem(icon, count) {
    const btn = el('button', 'act-item');
    btn.type = 'button';
    btn.innerHTML = icon;
    btn.appendChild(document.createTextNode(String(count)));
    return btn;
  }

  /* ==========================================================
     四、渲染：首页
     ========================================================== */

  function renderProfile() {
    setText('profileName', ME.name);
    setText('profileSign', ME.signature);
    setText('momentsName', ME.name);
    setText('momentsSign', ME.signature);
  }

  function renderMoods() {
    const box = document.getElementById('moods');
    box.textContent = '';

    if (!MOODS.length) {
      box.appendChild(el('li', 'mood-empty', EMPTY.moods));
      return;
    }

    MOODS.forEach(function (mood) {
      const li = el('li', 'mood-item');
      li.appendChild(el('span', 'mood-emoji', mood.emoji));
      li.appendChild(el('span', 'mood-line', mood.label + mood.value));
      box.appendChild(li);
    });
  }

  function renderRecent() {
    setText('recentText', MOMENTS.length ? MOMENTS[0].text : EMPTY.recent);
  }

  function renderAbilities() {
    const box = document.getElementById('abilities');
    box.textContent = '';

    ABILITIES.forEach(function (item) {
      const btn = el('button', 'ability');
      btn.type = 'button';
      btn.dataset.key = item.key;

      const ico = el('span', 'ability-ico');
      ico.innerHTML = ABILITY_ICONS[item.key] || '';
      btn.appendChild(ico);
      btn.appendChild(el('span', 'ability-label', item.label));

      btn.addEventListener('click', function () {
        showToast(item.label + ' · 敬请期待');
      });

      box.appendChild(btn);
    });
  }

  /* ==========================================================
     五、渲染：聊天
     ========================================================== */

  function activeSession() {
    for (let i = 0; i < SESSIONS.length; i++) {
      if (SESSIONS[i].id === state.activeId) return SESSIONS[i];
    }
    return SESSIONS[0];
  }

  function paintSessionAvatar(node, session) {
    if (!node) return;
    if (session.avatar === 'photo') {
      node.classList.add('avatar-photo');
      node.textContent = '';
    } else {
      node.classList.add('avatar-emoji');
      node.textContent = session.avatar;
    }
  }

  /** 特别关注：在头像右下角加个小星标 */
  function paintStarBadge(node, on) {
    if (!node) return;

    let badge = node.querySelector('.star-badge');
    if (!on) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = el('span', 'star-badge');
      badge.setAttribute('aria-label', '特别关注');
      badge.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.6c-.6 0-6.9-4.2-6.9-9.1A3.9 3.9 0 0 1 12 8.7a3.9 3.9 0 0 1 6.9 2.8c0 4.9-6.3 9.1-6.9 9.1z"/></svg>';
      node.appendChild(badge);
    }
  }

  function renderSessions() {
    const box = document.getElementById('sessionList');
    if (!box) return;
    box.textContent = '';

    const q = (state.search || '').trim().toLowerCase();
    const list = SESSIONS.filter(function (item) {
      if (state.sessionFilter === 'friend') return item.type === 'friend';
      if (state.sessionFilter === 'group') return item.type === 'group';
      return true;
    }).filter(function (item) {
      if (!q) return true;
      const last = item.messages.length ? item.messages[item.messages.length - 1] : null;
      const hay = (item.name + ' ' + (last ? last.text : '')).toLowerCase();
      return hay.indexOf(q) !== -1;
    });

    if (!list.length) {
      box.appendChild(el('p', 'session-empty', q ? '没有找到「' + state.search.trim() + '」' : EMPTY.sessions));
      return;
    }

    list.forEach(function (session) {
      const last = session.messages.length ? session.messages[session.messages.length - 1] : null;

      const row = el('button', 'session');
      row.type = 'button';

      const avatar = el('div', 'session-avatar');
      paintSessionAvatar(avatar, session);
      paintStarBadge(avatar, !!session.starred);
      row.appendChild(avatar);

      const main = el('div', 'session-main');
      const top = el('div', 'session-top');
      const nameWrap = el('span', 'session-name-wrap');
      nameWrap.appendChild(el('span', 'session-name', session.name));
      if (session.pinned) nameWrap.appendChild(el('span', 'session-pin', '置顶'));
      top.appendChild(nameWrap);
      top.appendChild(el('span', 'session-time', last ? last.time : ''));
      main.appendChild(top);

      const preview = last
        ? (last.from === 'me' ? '我：' : '') +
          (last.kind === 'voice' ? '[语音] ' + last.duration + '"' : last.text)
        : EMPTY.chat;
      main.appendChild(el('div', 'session-preview', preview));

      row.appendChild(main);
      if (session.unread) row.appendChild(el('span', 'session-unread'));
      row.appendChild(el('span', 'chev', '›'));

      /* 长按 480ms 出菜单；松手/滑动取消，长按后不触发进入聊天 */
      let pressTimer = null;
      let longPressed = false;

      const cancelPress = function () {
        if (pressTimer) {
          window.clearTimeout(pressTimer);
          pressTimer = null;
        }
      };

      row.addEventListener('pointerdown', function (event) {
        longPressed = false;
        cancelPress();
        pressTimer = window.setTimeout(function () {
          pressTimer = null;
          longPressed = true;
          openRowMenu(session);
        }, 480);
        if (event.pointerId !== undefined && row.setPointerCapture) {
          try { row.setPointerCapture(event.pointerId); } catch (err) {}
        }
      });
      row.addEventListener('pointerup', cancelPress);
      row.addEventListener('pointerleave', cancelPress);
      row.addEventListener('pointercancel', cancelPress);
      row.addEventListener('pointermove', cancelPress);

      row.addEventListener('click', function () {
        if (longPressed) {
          longPressed = false;
          return;
        }
        if (session.unread) {
          session.unread = false;
          renderSessions();
        }
        state.activeId = session.id;
        go('chatdetail');
      });

      box.appendChild(row);
    });
  }

  /* ---- 会话长按菜单 ---- */
  let menuTarget = null;

  function openRowMenu(session) {
    const menu = document.getElementById('rowMenu');
    const mask = document.getElementById('menuMask');
    if (!menu || !mask) return;

    menuTarget = session;
    menu.hidden = false;
    mask.hidden = false;
    window.requestAnimationFrame(function () {
      menu.classList.add('is-on');
      mask.classList.add('is-on');
    });
  }

  function closeRowMenu() {
    const menu = document.getElementById('rowMenu');
    const mask = document.getElementById('menuMask');
    if (!menu || !mask) return;

    menu.classList.remove('is-on');
    mask.classList.remove('is-on');
    window.setTimeout(function () {
      menu.hidden = true;
      mask.hidden = true;
    }, 200);
    menuTarget = null;
  }

  function handleMenuAction(action) {
    const session = menuTarget;
    closeRowMenu();
    if (!session || action === 'cancel') return;

    if (action === 'pin') {
      session.pinned = !session.pinned;
      renderSessions();
      showToast(session.pinned ? '已置顶聊天' : '已取消置顶');
      return;
    }
    if (action === 'star') {
      session.starred = !session.starred;
      renderSessions(); /* 头像角标要跟着刷 */
      showToast(session.starred ? '已设为特别关注' : '已取消特别关注');
      return;
    }
    if (action === 'unread') {
      session.unread = true;
      renderSessions();
      showToast('已标记未读');
    }
  }

  function renderChat() {
    const session = activeSession();
    setText('chatTitle', session.name);
    setTyping(replyTimer !== null && replySession === session);

    const avatar = document.getElementById('chatAvatar');
    if (avatar) {
      avatar.className = 'chat-avatar';
      paintSessionAvatar(avatar, session);
      paintStarBadge(avatar, !!session.starred);
    }

    const list = document.getElementById('chatList');
    list.textContent = '';

    list.classList.toggle('is-empty', !session.messages.length);

    if (!session.messages.length) {
      list.appendChild(el('p', 'chat-empty', EMPTY.chat));
      return;
    }

    session.messages.forEach(function (msg) {
      const isMe = msg.from === 'me';
      const row = el('div', 'msg ' + (isMe ? 'msg-me' : 'msg-her'));

      /* 对方：头像在左 */
      if (!isMe) {
        const av = el('div', 'msg-avatar');
        paintSessionAvatar(av, session);
        row.appendChild(av);
      }

      /* 我方消息的发送状态：失败红感叹号在气泡左侧（点一下重发）；发送中转圈 */
      if (isMe && (msg.state === 'failed' || msg.state === 'sending')) {
        const mark = el('button', 'msg-fail' + (msg.state === 'sending' ? ' is-sending' : ''));
        mark.type = 'button';
        mark.setAttribute('aria-label', msg.state === 'sending' ? '发送中' : '重新发送');
        mark.innerHTML =
          msg.state === 'sending'
            ? '<span class="spin"></span>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.4v7.2"/><circle cx="12" cy="17.4" r="1.1" fill="currentColor" stroke="none"/></svg>';
        if (msg.state === 'failed') {
          mark.addEventListener('click', function () {
            retryMessage(session, msg);
          });
        }
        row.appendChild(mark);
      }

      const body = el('div', 'msg-body');

      if (msg.kind === 'voice') {
        const vb = el('div', 'bubble bubble-voice');
        vb.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 10v4M8.4 7.4v9.2M12 4.8v14.4M15.6 8v8M19.4 10.4v3.2"/></svg>';
        vb.appendChild(el('span', 'voice-dur', msg.duration + '"'));
        vb.style.minWidth = Math.min(190, 66 + msg.duration * 14) + 'px';
        body.appendChild(vb);
      } else {
        body.appendChild(el('div', 'bubble', msg.text));
      }

      /* 气泡下方：两边都显示时间；token 只在对方（左）显示，代表这次回复的消耗 */
      const meta = el('div', 'msg-meta');
      meta.appendChild(el('span', 'msg-time', msg.time));
      if (!isMe) meta.appendChild(el('span', 'msg-token', tokensLabel(msg)));
      body.appendChild(meta);

      row.appendChild(body);

      /* 我：头像在右 */
      if (isMe) {
        const mine = el('div', 'msg-avatar msg-avatar-me');
        paintAvatar(mine, state.user.avatar);
        row.appendChild(mine);
      }

      list.appendChild(row);
    });
  }

  function scrollChatToBottom() {
    const box = document.getElementById('chatScroll');
    if (!box) return;
    box.scrollTop = box.scrollHeight;
    window.requestAnimationFrame(function () {
      box.scrollTop = box.scrollHeight;
    });
  }

  /* ==========================================================
     更多功能：点 ＋ 从底部滑出面板，一行 4 个、一页 2 行、左右滑动翻页
     ========================================================== */

  /* 输入栏左侧按钮：语音面板开着时变成键盘，点一下切回打字 */
  const MIC_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9.2" y="3.6" width="5.6" height="9.4" rx="2.8"/><path d="M6 11.4a6 6 0 0 0 12 0M12 17.4v3"/></svg>';

  const KEYBOARD_ICON =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.6" y="6.4" width="16.8" height="11.2" rx="2.4"/><path d="M7.4 10.4h.01M10.6 10.4h.01M13.8 10.4h.01M17 10.4h.01M7.4 13.8h.01M10.6 13.8h.01M13.8 13.8h.01M17 13.8h.01M8.6 16.6h6.8"/></svg>';

  const PLUS_ITEMS = [
    {
      key: 'camera',
      label: '相机',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 8.6h2.8L9 6.6h6l1.6 2h2.8v9.8H4.6z"/><circle cx="12" cy="13.2" r="3.1"/></svg>',
    },
    {
      key: 'album',
      label: '相册',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5.4" width="16" height="13.2" rx="2.4"/><circle cx="8.8" cy="10.2" r="1.3"/><path d="M5.6 17.2l4.6-4.2 3.1 2.9 2.4-2.2 3.1 2.9"/></svg>',
    },
    {
      key: 'file',
      label: '文件',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.6h6.2l3.8 3.9v10.9H7z"/><path d="M13.2 4.6v4h3.8"/></svg>',
    },
  ];

  const PLUS_PER_PAGE = 8; /* 一行 4 个 × 2 行 */

  function renderPlus() {
    const pager = document.getElementById('plusPager');
    const dots = document.getElementById('plusDots');
    if (!pager || !dots) return;

    pager.textContent = '';
    dots.textContent = '';

    const pages = [];
    for (let i = 0; i < PLUS_ITEMS.length; i += PLUS_PER_PAGE) {
      pages.push(PLUS_ITEMS.slice(i, i + PLUS_PER_PAGE));
    }
    if (!pages.length) pages.push([]);

    pages.forEach(function (items, index) {
      const page = el('div', 'plus-page');
      items.forEach(function (item) {
        const btn = el('button', 'plus-item');
        btn.type = 'button';
        const ico = el('span', 'plus-ico');
        ico.innerHTML = item.icon;
        btn.appendChild(ico);
        btn.appendChild(el('span', 'plus-label', item.label));
        btn.addEventListener('click', function () {
          showToast(item.label + ' · 待接入');
        });
        page.appendChild(btn);
      });
      pager.appendChild(page);

      dots.appendChild(el('span', 'plus-dot' + (index === 0 ? ' is-on' : '')));
    });
  }

  function updatePlusDots() {
    const pager = document.getElementById('plusPager');
    if (!pager) return;
    const dots = pager.parentElement.querySelectorAll('.plus-dot');
    if (!dots.length) return;
    const w = pager.clientWidth || 1;
    const idx = Math.min(dots.length - 1, Math.max(0, Math.round(pager.scrollLeft / w)));
    for (let i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('is-on', i === idx);
    }
  }

  function plusOpen(open) {
    const page = document.getElementById('page-chat');
    if (!page) return;
    page.classList.toggle('is-plus', !!open);

    const btn = document.getElementById('plusToggle');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');

    const sheet = document.getElementById('plusSheet');
    if (sheet) sheet.setAttribute('aria-hidden', open ? 'false' : 'true');

    if (open) {
      voiceOpen(false);
      updatePlusDots();
      page.style.setProperty('--panel-h', sheet ? sheet.offsetHeight + 'px' : '217px');
    }
  }

  /* ==========================================================
     语音：点麦克风从底部滑出面板，按住说话 / 上滑取消 / 松开发送
     （现在是模拟录音，接后端时把 endRecording 里的 push 换成真实上传即可）
     ========================================================== */

  let rec = null;

  function showToast(text) {
    const node = document.getElementById('chatToast');
    if (!node) return;
    node.textContent = text;
    node.classList.add('is-show');
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(function () {
      node.classList.remove('is-show');
    }, 1400);
  }

  function paintRecUi(on, cancel) {
    const panel = document.getElementById('recPanel');
    const tip = document.getElementById('voiceTip');
    const btn = document.getElementById('holdBtn');
    if (panel) panel.classList.toggle('is-on', !!on);
    if (panel) panel.classList.toggle('is-cancel', !!cancel);
    if (btn) {
      btn.classList.toggle('is-rec', !!on);
      btn.classList.toggle('is-cancel', !!cancel);
      btn.querySelector('.hold-label').textContent = cancel ? '松开手指，取消发送' : '按住 说话';
    }
    if (tip) {
      tip.classList.toggle('is-cancel', !!cancel);
      tip.textContent = cancel ? '松开取消' : '上滑取消';
    }
    const hint = document.getElementById('recHint');
    if (hint) hint.textContent = cancel ? '松开取消' : '松开发送 · 上滑取消';
  }

  function paintVoiceToggle() {
    const btn = document.getElementById('voiceToggle');
    if (!btn) return;
    const page = document.getElementById('page-chat');
    const on = page && page.classList.contains('is-voice');
    btn.innerHTML = on ? KEYBOARD_ICON : MIC_ICON;
    btn.setAttribute('aria-label', on ? '切回键盘' : '语音');
  }

  function voiceOpen(open) {
    const page = document.getElementById('page-chat');
    if (!page) return;
    page.classList.toggle('is-voice', !!open);
    const btn = document.getElementById('voiceToggle');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    const sheet = document.getElementById('voiceSheet');
    if (sheet) sheet.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (!open) endRecording(false);
    if (open) {
      plusOpen(false);
      page.style.setProperty('--panel-h', sheet ? sheet.offsetHeight + 'px' : '173px');
    }
    paintVoiceToggle();
  }

  function startRecording(event) {
    if (rec) return;
    if (event && event.cancelable) event.preventDefault();

    rec = { start: Date.now(), y: event ? event.clientY : 0, cancel: false, timer: null };

    /* 浮层要浮在「输入栏」上方，所以位置按面板 + 输入栏高度算 */
    const panel = document.getElementById('recPanel');
    const sheet = document.getElementById('voiceSheet');
    const composer = document.querySelector('.composer');
    if (panel && sheet && composer) {
      panel.style.bottom = sheet.offsetHeight + composer.offsetHeight + 12 + 'px';
    }

    paintRecUi(true, false);
    const time = document.getElementById('recTime');
    if (time) time.textContent = '0"';

    rec.timer = window.setInterval(function () {
      if (!rec) return;
      const sec = Math.floor((Date.now() - rec.start) / 1000);
      if (time) time.textContent = sec + '"';
    }, 200);
  }

  function moveRecording(event) {
    if (!rec) return;
    const up = rec.y - event.clientY;
    const cancel = up > 58; /* 上滑超过 58px 算取消 */
    if (cancel !== rec.cancel) {
      rec.cancel = cancel;
      paintRecUi(true, cancel);
    }
  }

  function endRecording(commit) {
    if (!rec) return;

    window.clearInterval(rec.timer);
    const raw = (Date.now() - rec.start) / 1000;
    const cancelled = rec.cancel;
    rec = null;
    paintRecUi(false, false);

    if (!commit) return;
    if (cancelled) {
      showToast('已取消');
      return;
    }
    if (raw < 0.6) {
      showToast('说话时间太短');
      return;
    }

    const seconds = Math.max(1, Math.round(raw));
    const session = activeSession();
    pushMine(session, { kind: 'voice', duration: seconds });
  }

  /* ---- 测试用的固定回复：发什么都回同一段，延迟 0.9s 模拟对方在打字 ---- */

  let replyTimer = null;
  let replySession = null;

  let typingNow = false;

  function isOnline() {
    return navigator.onLine !== false;
  }

  /* 状态行：正在输入 > 离线 > 在线 */
  function refreshChatStatus() {
    const node = document.getElementById('chatStatusText');
    if (!node) return;
    node.textContent = typingNow ? '正在输入…' : isOnline() ? '在线' : '离线';
    node.classList.toggle('is-offline', !typingNow && !isOnline());
  }

  function setTyping(on) {
    typingNow = !!on;
    refreshChatStatus();
  }

  function scheduleReply(session) {
    if (replyTimer) window.clearTimeout(replyTimer);

    replySession = session;
    setTyping(true);

    replyTimer = window.setTimeout(function () {
      replyTimer = null;
      session.messages.push({ from: 'her', text: AUTO_REPLY, time: nowTime() });

      if (activeSession() === session) {
        setTyping(false);
        renderChat();
        scrollChatToBottom();
      }
    }, 900);
  }

  /* 离线时消息照样落到列表里，但带 failed 状态（红色感叹号，点一下重发） */
  function pushMine(session, extra) {
    const msg = Object.assign(
      { from: 'me', text: '', time: nowTime(), state: isOnline() ? 'ok' : 'failed' },
      extra
    );
    session.messages.push(msg);
    renderChat();
    scrollChatToBottom();

    if (msg.state === 'failed') {
      showToast('当前离线，消息没有发出去');
    } else {
      scheduleReply(session);
    }
    return msg;
  }

  function retryMessage(session, msg) {
    if (!isOnline()) {
      showToast('还是没有网络，等一下再试');
      return;
    }
    msg.state = 'sending';
    renderChat();

    window.setTimeout(function () {
      msg.state = 'ok';
      renderChat();
      scheduleReply(session);
    }, 600);
  }

  function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    input.value = '';
    pushMine(activeSession(), { text: text });
  }

  /* ==========================================================
     六、渲染：朋友圈
     ========================================================== */

  function renderMoments() {
    const list = document.getElementById('momentsList');
    list.textContent = '';

    const items = MOMENTS.filter(function (item) {
      if (state.momentFilter === 'friend') return item.who === ME.name;
      return true;
    });

    if (!items.length) {
      const box = el('div', 'empty-card');
      box.appendChild(el('p', 'empty-note', EMPTY.moments));
      list.appendChild(box);
      return;
    }

    items.forEach(function (item) {
      const card = el('article', 'moment');
      const isSelf = item.who === ME.name;

      const head = el('div', 'moment-head');
      const avatar = el('div', 'moment-avatar');
      if (isSelf) {
        avatar.classList.add('avatar-photo');
      } else {
        avatar.classList.add('avatar-emoji');
        avatar.textContent = item.avatar;
      }
      head.appendChild(avatar);

      const meta = el('div', 'moment-meta');
      meta.appendChild(el('div', 'moment-name', item.who));
      meta.appendChild(el('div', 'moment-time', item.time));
      head.appendChild(meta);

      const more = el('button', 'moment-more', '⋯');
      more.type = 'button';
      head.appendChild(more);

      card.appendChild(head);
      card.appendChild(el('p', 'moment-text', item.text));

      if (item.image) card.appendChild(el('div', 'moment-img'));

      const actions = el('div', 'moment-actions');
      actions.appendChild(actionItem(ICON_LIKE, item.likes));
      actions.appendChild(actionItem(ICON_COMMENT, item.comments));
      card.appendChild(actions);

      list.appendChild(card);
    });
  }

  /* ==========================================================
     七、渲染：我的 / 编辑资料
     ========================================================== */

  function applyUser() {
    setText('meName', state.user.name);
    setText('meSign', state.user.signature);
    paintAvatar(document.getElementById('meAvatar'), state.user.avatar);
    paintAvatar(document.getElementById('editAvatar'), state.user.avatar);
  }

  function fillEditForm() {
    const name = document.getElementById('editName');
    const sign = document.getElementById('editSign');
    if (name) name.value = state.user.name;
    if (sign) sign.value = state.user.signature;
    paintAvatar(document.getElementById('editAvatar'), state.user.avatar);
  }

  function saveProfile() {
    const nameInput = document.getElementById('editName');
    const signInput = document.getElementById('editSign');

    const name = nameInput.value.trim();
    const sign = signInput.value.trim();

    state.user.name = name || state.user.name || USER_DEFAULT.name;
    state.user.signature = sign;
    applyUser();
    saveState();
    go('me');
  }

  function pickAvatar(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function () {
      const raw = reader.result;
      const img = new Image();

      img.onload = function () {
        /* 压到 256px 再存，避免 localStorage 被撑爆 */
        const max = 256;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        let url = raw;
        try {
          url = canvas.toDataURL('image/jpeg', 0.86);
        } catch (err) {
          url = raw;
        }

        state.user.avatar = url;
        paintAvatar(document.getElementById('editAvatar'), url);
        paintAvatar(document.getElementById('meAvatar'), url);
        saveState();
      };

      img.onerror = function () {
        state.user.avatar = raw;
        paintAvatar(document.getElementById('editAvatar'), raw);
        saveState();
      };

      img.src = raw;
    };

    reader.readAsDataURL(file);
  }

  /* ==========================================================
     八、设置页
     ========================================================== */

  function updateBgHint() {
    const hint = document.getElementById('bgHint');
    if (!hint) return;
    hint.textContent = state.bgDelivery ? '已开启 1 项设置' : '已关闭';
  }

  function updateCostHint() {
    const hint = document.getElementById('costHint');
    if (hint) hint.textContent = state.costMode ? '当前：¥ 金额' : '当前：Token';
  }

  function initCostSwitch() {
    const input = document.getElementById('costMode');
    if (!input) return;
    input.checked = state.costMode;
    input.addEventListener('change', function () {
      state.costMode = input.checked;
      updateCostHint();
      saveState();
      renderChat(); /* 立刻反映到聊天里的胶囊 */
    });
    updateCostHint();
  }

  function initBgSwitch() {
    const input = document.getElementById('bgDelivery');
    if (!input) return;
    input.checked = state.bgDelivery;
    input.addEventListener('change', function () {
      state.bgDelivery = input.checked;
      updateBgHint();
      saveState();
    });
    updateBgHint();
  }

  /* ==========================================================
     九、页面切换
     ========================================================== */

  let prevPage = 'home';

  const TAB_PAGES = ['home', 'chat', 'moments', 'me'];

  function currentPage() {
    const el = document.querySelector('.page.is-active');
    return el ? el.dataset.page : 'home';
  }

  function go(page, opts) {
    const activePage = document.querySelector('.page.is-active');
    if (activePage && activePage.dataset.page !== page) {
      prevPage = activePage.dataset.page;
    }

    const before = currentPage();
    const tab = PAGE_TAB[page] || null;
    if (tab) state.tab = tab;

    document.querySelectorAll('.page').forEach(function (section) {
      section.classList.toggle('is-active', section.dataset.page === page);
    });

    document.querySelectorAll('.tab-item').forEach(function (btn) {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    const isSub = page === 'settings' || page === 'editprofile' || page === 'chatdetail';
    document.getElementById('phone').classList.toggle('is-sub', isSub);

    if (page !== 'chatdetail') {
      voiceOpen(false);
      plusOpen(false);
    }

    /* 离开会话列表就把长按菜单收起来 */
    if (page !== 'chat') closeRowMenu();

    /* 离开会话列表就把搜索条收起来，回来是干净状态 */
    if (page !== 'chat' && state.search) {
      state.search = '';
      const bar = document.getElementById('searchBar');
      const field = document.getElementById('searchInput');
      if (bar) bar.hidden = true;
      if (field) field.value = '';
    }

    /* ---- 安卓返回键：靠 history 压栈 ----
       首页永远只有一层（再按返回就退出）；
       其它一级页压在首页之上（返回回首页）；二级页再叠一层（返回回上一页） */
    const fromHistory = opts && opts.fromHistory;
    if (!fromHistory && page !== before) {
      const targetIsTab = TAB_PAGES.indexOf(page) !== -1;
      const beforeIsTab = TAB_PAGES.indexOf(before) !== -1;

      if (page === 'home') {
        window.history.replaceState({ page: 'home' }, '');
      } else if (targetIsTab && beforeIsTab && before !== 'home') {
        window.history.replaceState({ page: page }, ''); /* 一级页之间互切不叠层 */
      } else {
        window.history.pushState({ page: page }, '');
      }
    }

    if (tab) saveState();
    if (page === 'chat') renderSessions();
    if (page === 'chatdetail') {
      renderChat();
      scrollChatToBottom();
    }
    if (page === 'editprofile') fillEditForm();

    const scroller = document.querySelector('.page.is-active .scroller');
    if (scroller) scroller.scrollTop = 0;
  }

  /* ==========================================================
     十、事件绑定
     ========================================================== */

  function bindEvents() {
    document.querySelectorAll('.tab-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        go(btn.dataset.tab);
      });
    });

    document.querySelectorAll('[data-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        go(btn.dataset.goto);
      });
    });

    document.querySelectorAll('.js-back').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (window.history.length > 1) window.history.back();
        else go('home');
      });
    });

    /* 系统返回键（浏览器 / WebView 的返回）＝ popstate */
    window.addEventListener('popstate', function (event) {
      const page = (event.state && event.state.page) || 'home';
      if (page === currentPage()) return; /* 已经在首页：交给系统退出 App */
      go(page, { fromHistory: true });
    });

    document.getElementById('sendBtn').addEventListener('click', sendMessage);

    /* ---- 语音面板 ---- */
    const voiceToggle = document.getElementById('voiceToggle');
    if (voiceToggle) {
      voiceToggle.addEventListener('click', function () {
        const page = document.getElementById('page-chat');
        voiceOpen(!page.classList.contains('is-voice'));
      });
    }

    /* 更多功能面板 */
    const plusToggle = document.getElementById('plusToggle');
    if (plusToggle) {
      plusToggle.addEventListener('click', function () {
        const page = document.getElementById('page-chat');
        plusOpen(!page.classList.contains('is-plus'));
      });
    }

    /* ---------- 运行环境：装在 App 里，还是手机浏览器？ ----------
       放在 App 的 WebView 里时，外层会注入 DshNative 这个对象；
       浏览器里没有。UI 里不再露开关，行为按环境自动定。 */
    const ENV_APP = typeof window.DshNative !== 'undefined' ||
      /DshWhale/i.test(navigator.userAgent || '');

    document.documentElement.dataset.env = ENV_APP ? 'app' : 'browser';

    /* App 里天生没有浏览器工具栏，默认就按"全屏"处理：交给原生把状态栏也收起来。
       浏览器里默认不折腾（requestFullscreen 必须用户手势，自动调只会被拦）。 */
    function enterFullscreen() {
      if (!ENV_APP) return false;
      try {
        window.DshNative.postMessage('fullscreen');
        return true;
      } catch (err) {
        return false;
      }
    }

    if (ENV_APP) enterFullscreen();

    /* 断网 / 恢复：状态行跟着变，恢复时提示可重发 */
    window.addEventListener('online', function () {
      refreshChatStatus();
      const session = activeSession();
      const failed = session.messages.filter(function (m) { return m.state === 'failed'; }).length;
      showToast(failed ? '网络恢复了，点红色感叹号重发' : '网络恢复了');
      renderChat();
    });

    window.addEventListener('offline', function () {
      refreshChatStatus();
      showToast('网络断了，消息会留在列表里');
    });

    /* 长按菜单：点遮罩 / 取消 关闭，点其它项执行动作 */
    const menuMask = document.getElementById('menuMask');
    const rowMenu = document.getElementById('rowMenu');
    if (menuMask) menuMask.addEventListener('click', function () { closeRowMenu(); });
    if (rowMenu) {
      rowMenu.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-menu]');
        if (!btn) return;
        handleMenuAction(btn.dataset.menu);
      });
    }

    /* 最近动态：整块卡片都能点，进朋友圈 */
    const recentCard = document.getElementById('recentCard');
    if (recentCard) {
      const openMoments = function () { go('moments'); };
      recentCard.addEventListener('click', openMoments);
      recentCard.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openMoments();
        }
      });
    }

    /* iOS Safari 只有页面有 touchstart 监听时才会触发 :active，这里垫一个空的 */
    document.addEventListener('touchstart', function () {}, { passive: true });

    /* 检查更新：装在 App 里就走原生（GitHub Releases），浏览器里只提示 */
    const checkUpdateRow = document.getElementById('checkUpdateRow');
    if (checkUpdateRow) {
      checkUpdateRow.addEventListener('click', function () {
        if (window.DshNative && window.DshNative.postMessage) {
          window.DshNative.postMessage('checkUpdate');
        } else {
          showToast('已是最新版本 · 网页预览不检查更新');
        }
      });
    }

    /* 所有带 data-toast 的元素：点一下弹提示 */
    document.querySelectorAll('[data-toast]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        showToast(btn.dataset.toast);
      });
    });

    /* 会话搜索 */
    const searchToggle = document.getElementById('searchToggle');
    const searchBar = document.getElementById('searchBar');
    const searchInput = document.getElementById('searchInput');
    const searchCancel = document.getElementById('searchCancel');

    function setSearch(open) {
      if (!searchBar) return;
      searchBar.hidden = !open;
      if (searchToggle) searchToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (!open) {
        state.search = '';
        if (searchInput) searchInput.value = '';
        renderSessions();
        return;
      }
      if (searchInput) {
        searchInput.value = state.search;
        window.setTimeout(function () { searchInput.focus(); }, 30);
      }
    }

    if (searchToggle) {
      searchToggle.addEventListener('click', function () {
        setSearch(searchBar.hidden);
      });
    }
    if (searchCancel) {
      searchCancel.addEventListener('click', function () { setSearch(false); });
    }
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        state.search = searchInput.value;
        renderSessions();
      });
      searchInput.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') setSearch(false);
      });
    }

    const plusPager = document.getElementById('plusPager');
    if (plusPager) plusPager.addEventListener('scroll', updatePlusDots, { passive: true });

    /* 点「弹出的面板」以外的任何地方（消息区、横幅、遮罩）都退回打字界面 */
    document.addEventListener(
      'pointerdown',
      function (event) {
        const page = document.getElementById('page-chat');
        if (!page) return;
        const voiceOn = page.classList.contains('is-voice');
        const plusOn = page.classList.contains('is-plus');
        if (!voiceOn && !plusOn) return;

        const t = event.target;
        if (t.closest('#voiceSheet') || t.closest('#voiceToggle')) return;
        if (t.closest('#plusSheet') || t.closest('#plusToggle')) return;

        voiceOpen(false);
        plusOpen(false);
      },
      true
    );

    const holdBtn = document.getElementById('holdBtn');
    if (holdBtn) {
      holdBtn.addEventListener('pointerdown', startRecording);
      holdBtn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }
    window.addEventListener('pointermove', moveRecording);
    window.addEventListener('pointerup', function () { endRecording(true); });
    window.addEventListener('pointercancel', function () { endRecording(false); });
    document.getElementById('chatInput').addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendMessage();
      }
    });

    /* 聊天列表：全部 / 好友 / 群聊 */
    document.querySelectorAll('.seg-btn[data-session]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.sessionFilter = btn.dataset.session;
        document.querySelectorAll('.seg-btn[data-session]').forEach(function (other) {
          const on = other === btn;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        renderSessions();
      });
    });

    /* 朋友圈：全部 / 好友 */
    document.querySelectorAll('.seg-btn[data-filter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.momentFilter = btn.dataset.filter;
        document.querySelectorAll('.seg-btn[data-filter]').forEach(function (other) {
          const on = other === btn;
          other.classList.toggle('is-on', on);
          other.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        renderMoments();
      });
    });

    /* 编辑资料 */
    const pick = document.getElementById('avatarPick');
    const fileInput = document.getElementById('avatarFile');
    if (pick && fileInput) {
      pick.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        pickAvatar(fileInput.files && fileInput.files[0]);
        fileInput.value = '';
      });
    }

    document.getElementById('saveProfile').addEventListener('click', saveProfile);
  }

  /* ==========================================================
     十一、启动
     ========================================================== */

  function init() {
    loadState();

    renderProfile();
    renderMoods();
    renderRecent();
    renderAbilities();
    renderSessions();
    renderChat();
    renderMoments();
    applyUser();
    bindViewportHeight();
    initBgSwitch();
    initCostSwitch();
    renderPlus();
    paintVoiceToggle();
    refreshChatStatus();

    /* Service Worker：装成 App 后离线也能打开（https / localhost 才生效） */
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
    startSlotTimer();

    bindEvents();
    window.history.replaceState({ page: 'home' }, '');
    go(state.tab);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
