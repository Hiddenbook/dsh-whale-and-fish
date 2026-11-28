/* ===========================================================
   DSH · 鲸与鱼 —— 界面层逻辑
   纯原生 JS。不发任何网络请求，全部假数据写在文件顶部。
   =========================================================== */

(function () {
  'use strict';

  /* 版本号：这两行由 stamp-version.py 按 pubspec.yaml 自动改写，别手改。
     TEST_BUILD = 上次发布之后第几次改动；0 表示正式版，不显示括号。 */
  const APP_VERSION = '0.1.6';
  const TEST_BUILD = 0;

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
  /* 当前是手机还是电脑（看设备，不看浏览器）：App 里一定是 phone；
     电脑浏览器用"没有触摸 + 精细指针 + 宽屏"判断 */
  function detectDevice() {
    if (typeof window.DshDevice === 'string') return window.DshDevice; /* 原生可直接指定 */
    if (typeof window.DshNative !== 'undefined') return 'phone';      /* App 里 */
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const narrow = window.innerWidth < 620;
    return coarse || narrow ? 'phone' : 'desktop';
  }

  const DEVICE = detectDevice();

  const SESSIONS = [
    { id: 'xiaoyu', name: '小鱼', type: 'friend', avatar: 'photo', messages: [] },
    {
      id: 'peer',
      name: DEVICE === 'phone' ? '我的电脑' : '我的手机',
      type: 'peer',
      /* 用「我」的资料图，和我的页同一个素材（DEVICE 只影响名字） */
      avatar: 'user',
      messages: [],
    },
  ];

  /** 朋友圈动态（清空状态，接手后端后往这里填） */
  const MOMENTS = [];


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

  /* ---- 软键盘 ----------------------------------------------------------
     键盘弹起：外壳压到 visualViewport 高度，输入栏贴着键盘；
     键盘收起：把 height 还给 100dvh，别一帧帧往回放，否则底部会露出一截空白。
     ------------------------------------------------------------------- */
  let lastViewportH = 0;
  let viewportRaf = 0;

  let kbTimer = 0;

  /** 键盘动画停下后再设高度：一步到位，避免逐帧重排 */
  function applyKeyboardHeight() {
    kbTimer = 0;
    const phone = document.querySelector('.phone');
    if (!phone || !phone.classList.contains('is-keyboard')) return;

    const vv = window.visualViewport;
    const vh = Math.round(vv ? vv.height : window.innerHeight);
    if (!vh) return;

    phone.style.height = vh + 'px';
    lastViewportH = vh;
    scrollChatToBottom();
  }

  let appVhLock = 0;   /* App 里外壳锁定的高度（启动时记一次） */
  let appKbLast = 0;
  let nativeKeyboard = false;  /* 原生上报过键盘高度后，就不再自己从视口算 */

  /** 键盘高度的统一入口：原生上报和 visualViewport 两条路都走这里 */
  function applyKeyboardHeight(kb) {
    const phone = document.querySelector('.phone');
    if (!phone) return;

    const root = document.documentElement;
    kb = Math.max(0, Math.round(kb || 0));

    /* 原生上报的是键盘动画的逐帧高度（0 → 900 之间十几个中间值），
       阈值卡在 80 会让动画的头尾各丢一截，看着就是"慢半拍"。
       浏览器自己从视口算的那条路会夹带地址栏伸缩，留一点死区。 */
    const openAt = nativeKeyboard ? 0 : 80;

    if (kb > openAt) {
      root.classList.remove('kb-off');
      if (!phone.classList.contains('is-keyboard')) phone.classList.add('is-keyboard');

      /* 输入栏每帧跟着键盘走：transform 不触发重排 */
      root.style.setProperty('--kb', kb + 'px');

      /* 列表留白要重排，等键盘停稳再改 */
      if (kb !== appKbLast) {
        appKbLast = kb;
        if (kbTimer) window.clearTimeout(kbTimer);
        kbTimer = window.setTimeout(function () {
          kbTimer = 0;
          root.style.setProperty('--kb-pad', kb + 'px');
          scrollChatToBottom();
        }, 130);
      }
      return;
    }

    if (!phone.classList.contains('is-keyboard')) return;

    if (kbTimer) {
      window.clearTimeout(kbTimer);
      kbTimer = 0;
    }
    appKbLast = 0;
    root.style.setProperty('--kb', '0px');
    root.style.setProperty('--kb-pad', '0px');
    phone.classList.remove('is-keyboard');
    root.classList.add('kb-off');
    phone.classList.add('kb-resetting');
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        phone.classList.remove('kb-resetting');
        scrollChatToBottom();
      });
    });
  }

  /* 原生（Flutter）上报的键盘高度（px）。
     原生拿到的是系统 IME insets，跟键盘动画同一条时间线，
     比等 WebView 自己 resize 完再算要快一截。 */
  window.DshKeyboard = function (px) {
    const phone = document.querySelector('.phone');
    if (!phone) return;

    nativeKeyboard = true;
    applyKeyboardHeight(px);
  };

  function applyViewportHeight() {
    viewportRaf = 0;

    const phone = document.querySelector('.phone');
    if (!phone) return;

    /* ---------------- App（WebView）----------------
       WebView 会随键盘缩小，如果外壳跟着 100dvh 变，每帧都要重排整页 → 卡。
       所以外壳高度锁在启动时的值，键盘缩小时页面布局完全不动（超出部分被裁掉），
       只把输入栏用 transform 抬到键盘上方。键盘高度 = 锁定高度 - 当前视口高度，
       等它稳定再写一次，中间不留过渡帧。 */
    if (document.documentElement.dataset.env === 'app') {
      if (nativeKeyboard) return;   /* 已经在用原生上报的高度，别再抢 */

      const vv = window.visualViewport;
      const vh = Math.round(vv ? vv.height : window.innerHeight);
      if (!appVhLock) appVhLock = Math.round(window.innerHeight);
      if (!vh) return;

      const kb = Math.max(0, appVhLock - vh);
      applyKeyboardHeight(kb);
      return;
    }


    const vv = window.visualViewport;
    const vh = Math.round(vv ? vv.height : window.innerHeight);
    const wh = Math.round(window.innerHeight);
    if (!vh) return;

    const keyboard = wh - vh;

    if (keyboard > 80) {
      phone.classList.add('is-keyboard');

      /* 键盘弹起是有动画的，visualViewport.height 会连着变几十帧。
         逐帧改外壳高度会让整页跟着重排（列表、输入栏一起动），看起来就是掉帧。
         这里改成"等它停下来再一次性设到位"——中间页面不动，稳定后一步到位。 */
      if (vh !== lastViewportH) {
        if (kbTimer) window.clearTimeout(kbTimer);
        kbTimer = window.setTimeout(applyKeyboardHeight, 120);
      } else if (phone.style.height !== vh + 'px' && !kbTimer) {
        phone.style.height = vh + 'px';
      }
    } else if (phone.classList.contains('is-keyboard')) {
      /* 键盘刚收起：立刻交还给 CSS 的 100dvh，避免逐帧回弹留下色带 */
      if (kbTimer) {
        window.clearTimeout(kbTimer);
        kbTimer = 0;
      }
      phone.style.height = '';
      phone.classList.remove('is-keyboard');
      phone.classList.remove('is-kb-settled');
      window.requestAnimationFrame(function () {
        phone.classList.add('is-kb-settled');
        scrollChatToBottom();
      });
    }

    const shrankTo = lastViewportH && vh < lastViewportH - 60;
    lastViewportH = vh;

    /* 键盘弹起过程中不要一帧一帧地滚列表（那也是掉帧的观感），
       等高度稳定后由 applyKeyboardHeight() 滚一次 */
    const page = document.getElementById('page-chat');
    if (!phone.classList.contains('is-keyboard') && shrankTo && page && page.classList.contains('is-active')) {
      scrollChatToBottom();
    }
  }

  function syncViewportHeight() {
    if (viewportRaf) return;
    viewportRaf = window.requestAnimationFrame(applyViewportHeight);
  }

  function bindViewportHeight() {
    /* App 里先把外壳高度钉住：之后 WebView 怎么缩，页面布局都不动。
       这里自己判断一次（不依赖 bindEvents 里那套，避免顺序问题）。 */
    const inApp = typeof window.DshNative !== 'undefined' ||
      document.documentElement.dataset.env === 'app';

    if (inApp) {
      document.documentElement.dataset.env = 'app';
      appVhLock = Math.round(window.innerHeight);
      document.documentElement.style.setProperty('--vh-lock', appVhLock + 'px');
    }

    syncViewportHeight();
    window.addEventListener('resize', syncViewportHeight);
    window.addEventListener('orientationchange', syncViewportHeight);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewportHeight);
      window.visualViewport.addEventListener('scroll', syncViewportHeight);
    }
  }

  /* 提前解码主图，别等第一次进页面才解码（那就是"显影"的来源） */
  function warmImages() {
    ['assets/xiaoyu.jpg', 'assets/avatar-user.jpg'].forEach(function (src) {
      const img = new Image();
      img.src = src;
      if (img.decode) img.decode().catch(function () {});
    });
  }

  /** 底部那行版本号：测试包带 (build)，正式版只有版本号 */
  function paintVersion() {
    const node = document.getElementById('versionLabel');
    if (!node) return;
    node.textContent = 'DSH · 鲸与鱼 · ' + APP_VERSION + (TEST_BUILD ? '(' + TEST_BUILD + ')' : '');
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
    link: null,
    newchat: null,
  };

  const state = {
    tab: 'home',
    /* 管道连接状态：unset 没配 / checking 正在查 / online 通了 / offline 连不上 */
    pipeStatus: 'unset',
    bgDelivery: true,
    costMode: false, /* false = 显示 token（默认）；true = 显示 ¥ */
    sessionFilter: 'all',
    search: '',
    quote: null, /* 正在引用的消息 */
    selectMode: false,
    selected: [], /* 多选中的消息下标 */
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

    /* 聊天记录：按 id 对回会话，消息多就整段恢复 */
    if (Array.isArray(saved.chats)) {
      saved.chats.forEach(function (savedChat) {
        let session = SESSIONS.find(function (item) { return item.id === savedChat.id; });
        if (!session) {
          /* 自己「创建聊天」建的会话不在种子里，得照存档还原一条 */
          if (!savedChat.custom) return;
          session = {
            id: savedChat.id,
            name: savedChat.name || '新聊天',
            type: savedChat.type === 'group' ? 'group' : 'friend',
            avatar: savedChat.avatar || '新',
            custom: true,
            pinned: false,
            starred: false,
            unread: false,
            unreadCount: 0,
            messages: [],
          };
          SESSIONS.push(session);
        }
        if (typeof savedChat.pinned === 'boolean') session.pinned = savedChat.pinned;
        if (typeof savedChat.starred === 'boolean') session.starred = savedChat.starred;
        if (typeof savedChat.unread === 'boolean') session.unread = savedChat.unread;
        /* 未读条数：老存档里只有布尔值，就按 1 条算 */
        session.unreadCount = typeof savedChat.unreadCount === 'number'
          ? Math.max(0, savedChat.unreadCount)
          : (savedChat.unread ? 1 : 0);
        if (Array.isArray(savedChat.messages)) {
          session.messages = savedChat.messages
            .filter(function (m) { return m && (m.text || m.kind); })
            .map(function (m) {
              return {
                from: m.from === 'me' ? 'me' : 'her',
                text: typeof m.text === 'string' ? m.text : '',
                time: m.time || '',
                kind: m.kind === 'voice' ? 'voice' : undefined,
                duration: m.duration || undefined,
                audio: typeof m.audio === 'string' ? m.audio : undefined,
                quote: m.quote && m.quote.text ? { who: m.quote.who || '', text: m.quote.text } : undefined,
                state: m.state === 'failed' ? 'failed' : 'ok',
              };
            });
        }
      });
    }
  }

  /** 把会话整理成可存的样子（语音带 audio dataURL，可能很大） */
  function packChats(dropAudio) {
    return SESSIONS.map(function (session) {
      return {
        id: session.id,
        pinned: !!session.pinned,
        starred: !!session.starred,
        unread: !!session.unread,
        unreadCount: session.unreadCount || 0,
        ...(session.custom
          ? { custom: true, name: session.name, type: session.type, avatar: session.avatar }
          : {}),
        messages: session.messages.map(function (msg) {
          const out = { from: msg.from, time: msg.time, state: msg.state || 'ok' };
          if (msg.kind) out.kind = msg.kind;
          if (msg.text) out.text = msg.text;
          if (msg.duration) out.duration = msg.duration;
          if (msg.quote) out.quote = msg.quote;
          if (msg.audio && !dropAudio) out.audio = msg.audio;
          return out;
        }),
      };
    });
  }

  function writeSave(payload) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  let saveTimer = null;

  function saveState() {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(flushSave, 260);
  }

  function flushSave() {
    saveTimer = null;
    const base = {
      tab: state.tab,
      bgDelivery: state.bgDelivery,
      costMode: state.costMode,
      user: state.user,
      chatSavedAt: Date.now(),
    };

    try {
      writeSave(Object.assign({ chats: packChats(false) }, base));
    } catch (err) {
      /* 空间不够：先把语音录音丢掉再存（聊天文字不能丢） */
      try {
        writeSave(Object.assign({ chats: packChats(true) }, base));
      } catch (err2) {
        try {
          writeSave(base);
        } catch (err3) {
          /* 真存不了就算了，不打断使用 */
        }
      }
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
    return state.costMode ? formatCost(n) : n + ' Token';
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

    /* 自己上传的头像：直接铺图，别的规则都不走 */
    if (typeof session.avatar === 'string' && session.avatar.indexOf('data:') === 0) {
      node.classList.remove('avatar-photo', 'avatar-user', 'avatar-emoji');
      node.classList.add('avatar-custom');
      node.style.backgroundImage = 'url("' + session.avatar + '")';
      node.textContent = '';
      return;
    }
    node.style.backgroundImage = '';

    if (session.avatar === 'photo' || session.avatar === 'user') {
      node.classList.add(session.avatar === 'user' ? 'avatar-user' : 'avatar-photo');
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

  /* 未读数：微信那种"红圆 + 数字"，钉在头像右上角 */
  function paintUnreadBadge(node, count) {
    if (!node) return;

    const n = Math.max(0, count || 0);
    const old = node.querySelector('.avatar-unread');

    if (!n) {
      if (old) old.remove();
      return;
    }

    const badge = old || el('span', 'avatar-unread');
    const text = n > 99 ? '99+' : String(n);
    if (badge.textContent !== text) badge.textContent = text;
    badge.setAttribute('aria-label', n + ' 条未读');
    if (!old) node.appendChild(badge);
  }

  /* ---------------- 渲染签名：数据没变就不重建 DOM ----------------
     每次进聊天页都重建会话列表，会把头像、缩略图全部重新解码，
     观感就是"从模糊到清晰"地显影一下；比较签名后跳过重建，切页就是瞬移 */
  let sessionsSig = '';
  let chatSig = '';

  function sessionsSignature() {
    const tail = function (session) {
      const msg = session.messages[session.messages.length - 1];
      return msg ? msg.time + '|' + (msg.text || msg.kind || '') : '';
    };
    return [
      state.sessionFilter,
      (state.search || '').trim(),
      SESSIONS.map(function (session) {
        return [
          session.id,
          session.pinned ? 1 : 0,
          session.starred ? 1 : 0,
          session.unreadCount || 0,
          session.messages.length,
          tail(session),
        ].join(',');
      }).join(';'),
    ].join('~');
  }

  function chatSignature(session) {
    const msg = session.messages[session.messages.length - 1];
    return [
      session.id,
      session.name,
      session.starred ? 1 : 0,
      state.selectMode ? 1 : 0,
      state.selected.join('.'),
      state.quote ? 1 : 0,
      session.messages.length,
      msg ? msg.time + '|' + (msg.state || '') + '|' + (msg.text || msg.kind || '') : '',
    ].join('~');
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

    /* 置顶的排在最前面；rest 之间保持原顺序（ES2019 起 sort 是稳定的） */
    list.sort(function (a, b) {
      return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    });

    if (!list.length) {
      box.appendChild(el('p', 'session-empty', q ? '没有找到「' + state.search.trim() + '」' : EMPTY.sessions));
      sessionsSig = sessionsSignature();
      return;
    }

    list.forEach(function (session) {
      const last = session.messages.length ? session.messages[session.messages.length - 1] : null;

      const row = el('button', 'session');
      row.type = 'button';
      row.dataset.id = session.id;
      if (session.pinned) row.classList.add('is-pinned');

      const avatar = el('div', 'session-avatar');
      paintSessionAvatar(avatar, session);
      paintStarBadge(avatar, !!session.starred);
      paintUnreadBadge(avatar, session.unreadCount || 0);
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
          openSessionMenu(session, row);
          /* 只挡住"松手那一下"的误触，过一会儿恢复正常点击 */
          window.setTimeout(function () { longPressed = false; }, 700);
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
        if (session.unread || session.unreadCount) {
          session.unread = false;
          session.unreadCount = 0;
          renderSessions();
        }
        state.activeId = session.id;
        go('chatdetail');
      });

      box.appendChild(row);
    });

    sessionsSig = sessionsSignature();
  }

  /* ---- 会话长按菜单 ---- */
  let menuTarget = null;

  /* ==========================================================
     局域网互发：「我的电脑 / 我的手机」
     电脑上跑 tools/serve.py（同一个服务），两边打开页面就能互发消息。
     手机 App 里页面是本地文件，需要手动填一次电脑地址（192.168.x.x:8080）。
     ========================================================== */
  const PEER_KEY = 'dsh.peer.base';
  const PEER_SINCE_KEY = 'dsh.peer.since';
  const PEER_CID_KEY = 'dsh.peer.cid';

  function peerClientId() {
    if (peer.cid) return peer.cid;
    /* 每个标签页 / 每个 App 一份（放 sessionStorage），
       否则同一个浏览器开两个页面会拿到同一个 id，互相收不到消息 */
    try {
      peer.cid = window.sessionStorage.getItem(PEER_CID_KEY) || '';
    } catch (err) {
      peer.cid = '';
    }
    if (!peer.cid) {
      peer.cid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try {
        window.sessionStorage.setItem(PEER_CID_KEY, peer.cid);
      } catch (err) {
        /* ignore */
      }
    }
    return peer.cid;
  }

  const peer = {
    role: DEVICE,
    cid: '',
    base: '',
    since: 0,
    online: false,
    generation: 0,
    timer: 0,
  };

  /* 调试用：控制台里能看 peer.since / online */
  window.__dshPeer = peer;
  window.__dshSessions = SESSIONS;

  function peerSession() {
    return SESSIONS.find(function (item) { return item.type === 'peer'; });
  }

  function peerAddress() {
    if (peer.base) return peer.base;
    try {
      peer.base = window.localStorage.getItem(PEER_KEY) || '';
    } catch (err) {
      peer.base = '';
    }
    if (!peer.base && /^https?:$/.test(location.protocol)) {
      peer.base = location.origin; /* 浏览器里就是当前地址 */
    }
    return peer.base;
  }

  function setPeerAddress(value) {
    peer.base = value.replace(/\/.*$/, '').trim();
    try {
      window.localStorage.setItem(PEER_KEY, peer.base);
    } catch (err) {
      /* ignore */
    }
    /* 换了地址要提醒原生服务指向新地址 */
    syncBackgroundPoll();
  }

  /** 后台接收：App 里交给原生前台服务（15 秒拉一次局域网中继，网页被冻结也不影响）；
   *  浏览器里做不到，只能记住开关状态。返回是否真的交给了原生。 */
  function syncBackgroundPoll() {
    if (!window.DshNative || !window.DshNative.postMessage) return false;
    const base = peerAddress();
    const on = !!state.bgDelivery && !!base;
    window.DshNative.postMessage('peerPoll:' + (on ? 1 : 0) + '|' + (base || ''));
    return true;
  }

  /* 原生发现没有通知权限时会回调这里，把开关退回关闭 */
  window.DshNotifyDenied = function () {
    state.bgDelivery = false;
    saveState();
    const toggle = document.getElementById('bgDelivery');
    if (toggle) toggle.checked = false;
    showToast('没有通知权限，后台接收已关闭');
  };

  function peerUrl(path) {
    const base = peerAddress();
    if (!base) return '';
    return (/^https?:\/\//.test(base) ? base : 'http://' + base) + path;
  }

  /** 聊天头部那行状态：peer 会话显示连接状态，其它还是"在线/正在输入" */
  function renderChatStatusLine() {
    const session = activeSession();
    if (session && session.type === 'peer') {
      paintPeerStatus();
      return;
    }
    refreshChatStatus();
  }

  function paintPeerStatus() {
    const session = peerSession();
    if (!session) return;

    const state = !peerAddress() ? '未设置地址' : peer.online ? '已连接' : '未连接';
    const node = document.getElementById('chatStatusText');
    if (node && activeSession().type === 'peer') {
      node.textContent = state + (peer.online ? ' · 点这里查看' : ' · 点这里设置');
      node.classList.toggle('is-offline', !peer.online);
    }
  }

  async function peerSend(text) {
    const url = peerUrl('/send');
    if (!url) {
      showToast('先设置电脑地址');
      return false;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: peer.role,
          cid: peerClientId(),
          text: text,
          time: nowTime(),
        }),
      });
      if (!res.ok) throw new Error('bad status');
      peer.online = true;
      paintPeerStatus();
      return true;
    } catch (err) {
      peer.online = false;
      paintPeerStatus();
      showToast('发不出去，检查电脑和地址');
      return false;
    }
  }

  function peerReceive(message) {
    const session = peerSession();
    if (!session) return;

    session.messages.push({
      from: 'her',
      text: message.text,
      time: message.time || nowTime(),
      state: 'ok',
    });
    saveState();

    if (activeSession() === session) {
      renderChat();
      scrollChatToBottom();
    } else {
      session.unread = true;
      session.unreadCount = (session.unreadCount || 0) + 1;
      if (sessionsSignature() !== sessionsSig) renderSessions();
    }

    /* 页面在后台时弹通知：这正是用来测「后台推送」的。
       但开了「后台推送」之后，原生前台服务自己会弹，这边再弹就成了两条一样的通知，
       所以那种情况这里闭嘴，只让服务弹。 */
    const nativeHandles = !!(state.bgDelivery && window.DshNative && peerAddress());
    if (!nativeHandles && document.visibilityState === 'hidden') {
      notifyUser(session.name + ' 发来消息', message.text);
    }
  }

  /** 拉一次增量（立即返回，不挂长连接） */
  async function peerFetchOnce(gen) {
    const url = peerUrl('/messages');
    if (!url) return;

    try {
      const res = await fetch(
        url + '?role=' + peer.role + '&cid=' + peerClientId() + '&since=' + peer.since,
        { cache: 'no-store' }
      );
      if (gen !== peer.generation) return;
      if (!res.ok) throw new Error('bad status');

      const data = await res.json();
      const list = data.messages || [];

      if (!peer.online) {
        peer.online = true;
        paintPeerStatus();
        if (activeSession().type === 'peer') renderChatStatusLine();
      }

      list.forEach(function (item) {
        if (!item || !item.seq || item.seq <= peer.since) return;
        peer.since = item.seq;
        try {
          window.localStorage.setItem(PEER_SINCE_KEY, String(peer.since));
        } catch (err) {
          /* ignore */
        }
        peerReceive(item);
      });
    } catch (err) {
      if (gen !== peer.generation) return;
      if (peer.online) {
        peer.online = false;
        paintPeerStatus();
        if (activeSession().type === 'peer') renderChatStatusLine();
      }
    }
  }

  function peerLoop(gen) {
    if (gen !== peer.generation) return;
    peerFetchOnce(gen).then(function () {
      if (gen !== peer.generation) return;
      peer.timer = window.setTimeout(function () {
        peerLoop(gen);
      }, peer.online ? 1000 : 3000);
    });
  }

  /** 首次连接先问服务端"现在到几号了"，否则会把历史消息当成新消息回放 */
  async function peerBootstrap() {
    if (peer.since) return;

    try {
      peer.since = Number(window.localStorage.getItem(PEER_SINCE_KEY) || 0);
    } catch (err) {
      peer.since = 0;
    }
    if (peer.since) return;

    try {
      const info = await fetch(peerUrl('/info'), { cache: 'no-store' }).then(function (r) {
        return r.json();
      });
      peer.since = Number(info.last || 0);
    } catch (err) {
      peer.since = 0;
    }
  }

  let peerStarting = false;

  async function peerStart() {
    if (!peerAddress() || peerStarting) return;
    peerStarting = true;

    await peerBootstrap();
    peerStarting = false;

    /* 换一代：旧循环醒来发现 gen 不匹配会自己退出 */
    peer.generation += 1;
    window.clearTimeout(peer.timer);
    peerLoop(peer.generation);
  }

  function peerStop() {
    peer.generation += 1;
    window.clearTimeout(peer.timer);
    peer.timer = 0;
  }

  /* 系统通知：App 里交给原生，浏览器里用 Notification API */
  function notifyUser(title, body) {
    if (window.DshNative) {
      try {
        window.DshNative.postMessage('notify:' + JSON.stringify({ title: title, body: body }));
        return;
      } catch (err) {
        /* fall through */
      }
    }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, { body: body });
      } catch (err) {
        /* ignore */
      }
    }
  }

  function ensureNotifyPermission() {
    if (window.DshNative) {
      window.DshNative.postMessage('requestNotify');
      return;
    }
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(function () {});
    }
  }

  /* ---- 悬浮菜单（仿微信：贴着被长按的元素弹出，带小三角） ---- */
  let popMenuNode = null;
  let popMaskNode = null;
  let popOnPick = null;

  function closePopMenu() {
    if (popMaskNode) {
      popMaskNode.remove();
      popMaskNode = null;
    }
    if (popMenuNode) {
      const node = popMenuNode;
      popMenuNode = null;
      node.classList.remove('is-on');
      window.setTimeout(function () { node.remove(); }, 140);
    }
    popOnPick = null;
    document.querySelectorAll('.msg.is-press').forEach(function (n) {
      n.classList.remove('is-press');
    });
  }

  /** items: [{ key, label, danger }]；anchorRect 传元素或矩形 */
  function openPopMenu(anchor, items, onPick) {
    closePopMenu();

    const host = document.querySelector('.phone');
    if (!host) return;

    const box = anchor.nodeType ? anchor.getBoundingClientRect() : anchor;
    const hostBox = host.getBoundingClientRect();

    const menu = el('div', 'pop-menu');
    items.forEach(function (item) {
      const btn = el('button', 'pop-menu-item' + (item.danger ? ' is-danger' : ''), item.label);
      btn.type = 'button';
      btn.addEventListener('click', function () {
        const pick = onPick;
        closePopMenu();
        if (pick) pick(item.key);
      });
      menu.appendChild(btn);
    });

    const mask = el('div', 'pop-mask');
    mask.addEventListener('click', closePopMenu);

    host.appendChild(mask);
    host.appendChild(menu);

    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const gap = 12;

    let top = box.top - hostBox.top - mh - gap;
    let arrow = 'bottom';
    if (top < 8) {
      top = box.bottom - hostBox.top + gap;
      arrow = 'top';
    }

    let left = box.left - hostBox.left + box.width / 2 - mw / 2;
    left = Math.max(8, Math.min(left, host.clientWidth - mw - 8));

    menu.style.top = top + 'px';
    menu.style.left = left + 'px';
    menu.dataset.arrow = arrow;
    menu.style.setProperty('--arrow-x', (box.left + box.width / 2 - left) + 'px');
    menu.style.setProperty('--origin', '50% ' + (arrow === 'bottom' ? '100%' : '0%'));

    popMenuNode = menu;
    popMaskNode = mask;
    popOnPick = onPick;

    window.requestAnimationFrame(function () { menu.classList.add('is-on'); });
  }

  /* ---- 会话长按：置顶 / 特别关注 / 标为未读 ---- */
  function openSessionMenu(session, anchor) {
    openPopMenu(
      anchor,
      [
        { key: 'pin', label: session.pinned ? '取消置顶' : '置顶聊天' },
        { key: 'star', label: session.starred ? '取消特别关注' : '设置特别关注' },
        { key: 'unread', label: '标为未读' },
        { key: 'clear', label: '清除聊天记录', danger: true },
      ].concat(session.custom ? [{ key: 'delete', label: '删除聊天', danger: true }] : []),
      function (key) {
        if (key === 'pin') {
          session.pinned = !session.pinned;
          saveState();
          renderSessions();
          showToast(session.pinned ? '已置顶聊天' : '已取消置顶');
          return;
        }
        if (key === 'star') {
          session.starred = !session.starred;
          renderSessions();
          showToast(session.starred ? '已设为特别关注' : '已取消特别关注');
          return;
        }
        if (key === 'unread') {
          session.unread = true;
          if (!session.unreadCount) session.unreadCount = 1;
          saveState();
          renderSessions();
          showToast('已标为未读');
          return;
        }
        if (key === 'clear') {
          confirmClearChat(session);
          return;
        }
        if (key === 'delete') {
          confirmDeleteChat(session);
        }
      }
    );
  }

  /** 清空这台手机上的聊天记录（不碰 DSH 那边），要再点一次确认 */
  function confirmClearChat(session) {
    if (!session.messages.length) {
      showToast('这个会话本来就没有记录');
      return;
    }

    openPopMenu(
      document.getElementById('sessionList').querySelector('[data-id="' + session.id + '"]') ||
        document.getElementById('sessionList'),
      [
        { key: 'yes', label: '确认清除（' + session.messages.length + ' 条）', danger: true },
        { key: 'no', label: '取消' },
      ],
      function (key) {
        if (key !== 'yes') return;
        session.messages = [];
        session.unread = false;
        session.unreadCount = 0;
        if (state.activeId === session.id) {
          state.selectMode = false;
          state.selected = [];
        }
        saveState();
        renderSessions();
        if (state.activeId === session.id) renderChat();
        showToast('已清除本机聊天记录');
      }
    );
  }

  /** 删掉自己建的聊天（自带的两个不给删），删之前再确认一次 */
  function confirmDeleteChat(session) {
    openPopMenu(
      document.getElementById('sessionList').querySelector('[data-id="' + session.id + '"]') ||
        document.getElementById('sessionList'),
      [
        { key: 'yes', label: '确认删除「' + session.name + '」', danger: true },
        { key: 'no', label: '取消' },
      ],
      function (key) {
        if (key !== 'yes') return;

        const idx = SESSIONS.indexOf(session);
        if (idx >= 0) SESSIONS.splice(idx, 1);

        if (state.activeId === session.id) {
          state.activeId = SESSIONS[0] ? SESSIONS[0].id : '';
          state.selectMode = false;
          state.selected = [];
          go('chat');
        }

        saveState();
        renderSessions();
        showToast('已删除「' + session.name + '」');
      },
    );
  }

  /* App 里按系统返回键时，先问这里：有浮层/多选/引用就先关掉，别直接退页面 */
  window.DshHandleBack = function () {
    const scanLayer = document.getElementById('scanLayer');
    if (scanLayer && !scanLayer.hidden) {
      closeScan();
      return true;
    }
    const updLayer = document.getElementById('updateLayer');
    if (updLayer && !updLayer.hidden) {
      if (!updBusy) closeUpdateLayer();
      return true;
    }
    const askLayer = document.getElementById('askLayer');
    if (askLayer && !askLayer.hidden) {
      closeAsk(null);
      return true;
    }
    if (document.querySelector('.pop-menu')) {
      closePopMenu();
      return true;
    }
    if (state.selectMode) {
      exitSelect();
      return true;
    }
    if (state.quote) {
      state.quote = null;
      renderQuoteBar();
      return true;
    }

    const chat = document.getElementById('page-chat');
    if (chat && (chat.classList.contains('is-voice') || chat.classList.contains('is-plus'))) {
      voiceOpen(false);
      plusOpen(false);
      return true;
    }

    const searchBar = document.getElementById('searchBar');
    if (searchBar && !searchBar.hidden) {
      const cancel = document.getElementById('searchCancel');
      if (cancel) cancel.click();
      return true;
    }

    return false;
  };

  function renderChat() {
    const session = activeSession();
    setText('chatTitle', session.name);
    if (session.type === 'peer') {
      paintPeerStatus();
    } else {
      setTyping(waitingSession === session);
    }

    const avatar = document.getElementById('chatAvatar');
    if (avatar) {
      avatar.className = 'chat-avatar';
      paintSessionAvatar(avatar, session);
      paintStarBadge(avatar, !!session.starred);
    }

    const list = document.getElementById('chatList');
    list.textContent = '';
    list.classList.toggle('is-empty', !session.messages.length);
    list.classList.toggle('is-select', !!state.selectMode);

    if (!session.messages.length) {
      list.appendChild(el('p', 'chat-empty', EMPTY.chat));
      updateSelectBar();
      return;
    }

    session.messages.forEach(function (msg, index) {
      const isMe = msg.from === 'me';
      const row = el('div', 'msg ' + (isMe ? 'msg-me' : 'msg-her'));
      row.dataset.idx = index;

      if (state.selectMode) {
        row.classList.add('is-selectable');
        if (state.selected.indexOf(index) !== -1) row.classList.add('is-selected');
        row.appendChild(el('span', 'msg-check'));
        row.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          toggleSelect(index);
        });
      }

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

      let bubble;
      if (msg.kind === 'voice') {
        bubble = el('div', 'bubble bubble-voice' + (msg.audio ? ' has-audio' : ''));
        bubble.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 10v4M8.4 7.4v9.2M12 4.8v14.4M15.6 8v8M19.4 10.4v3.2"/></svg>';
        bubble.appendChild(el('span', 'voice-dur', msg.duration + '"'));
        bubble.style.minWidth = Math.min(190, 66 + msg.duration * 14) + 'px';
        bubble.addEventListener('click', function (event) {
          if (state.selectMode) return;
          event.stopPropagation();
          playVoice(msg, bubble);
        });
      } else {
        bubble = el('div', 'bubble');
        if (msg.quote) bubble.appendChild(quoteBlock(msg.quote));
        bubble.appendChild(el('span', 'bubble-text', msg.text));
      }
      body.appendChild(bubble);

      /* 气泡下方：两边都显示时间；token 只在对方（左）显示 */
      const meta = el('div', 'msg-meta');
      meta.appendChild(el('span', 'msg-time', msg.time));
      /* 只有跟小鱼的对话才显示消耗；对端设备发的消息不算 token */
      if (!isMe && session.type !== 'peer') {
        meta.appendChild(el('span', 'msg-token', tokensLabel(msg)));
      }
      body.appendChild(meta);

      row.appendChild(body);

      /* 我：头像在右 */
      if (isMe) {
        const mine = el('div', 'msg-avatar msg-avatar-me');
        paintAvatar(mine, state.user.avatar);
        row.appendChild(mine);
      }

      if (!state.selectMode) bindBubbleMenu(row, bubble, msg, index, session);

      list.appendChild(row);
    });

    updateSelectBar();
    chatSig = chatSignature(session);
  }

  /** 气泡里的引用块 */
  function quoteBlock(quote) {
    const box = el('div', 'bubble-quote');
    box.appendChild(el('b', '', quote.who + '：'));
    box.appendChild(el('span', '', quote.text));
    return box;
  }

  /* ---------------- 消息长按：引用 / 删除 / 多选 ---------------- */

  function bindBubbleMenu(row, bubble, msg, index, session) {
    let timer = null;

    const cancel = function () {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    row.addEventListener('pointerdown', function () {
      cancel();
      timer = window.setTimeout(function () {
        timer = null;
        row.classList.add('is-press');
        const isVoice = msg.kind === 'voice';

        openPopMenu(
          bubble,
          [
            /* 语音没有文字可复制，第一项换成「转文字」（功能待做） */
            isVoice
              ? { key: 'toText', label: '转文字' }
              : { key: 'copy', label: '复制' },
            { key: 'quote', label: '引用' },
            { key: 'multi', label: '多选' },
            { key: 'delete', label: '删除', danger: true },
          ],
          function (key) {
            if (key === 'copy') copyMessage(msg);
            else if (key === 'toText') showToast('转文字 · 暂未开发');
            else if (key === 'quote') setQuote(msg, session);
            else if (key === 'multi') enterSelect(index);
            else if (key === 'delete') deleteMessage(index);
          }
        );
      }, 420);
    });

    row.addEventListener('pointerup', cancel);
    row.addEventListener('pointermove', cancel);
    row.addEventListener('pointercancel', cancel);
    row.addEventListener('pointerleave', cancel);
    row.addEventListener('contextmenu', function (event) { event.preventDefault(); });
  }

  /** 复制一条消息：App 里走原生剪贴板（WebView 对 file:// 的 clipboard API 时好时坏），
   *  浏览器里退回 navigator.clipboard，再不行用隐藏的 textarea + execCommand */
  function copyMessage(msg) {
    const text = msg.kind === 'voice' ? '[语音] ' + msg.duration + '"' : (msg.text || '');
    if (!text) return;

    const done = function () {
      showToast('已复制');
    };

    /* 同步的 execCommand：必须留在点击的手势栈里才有效，所以先试它 */
    const legacy = function () {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(area);
        area.select();
        area.setSelectionRange(0, text.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(area);
        return ok;
      } catch (err) {
        return false;
      }
    };

    if (window.DshNative && window.DshNative.postMessage) {
      window.DshNative.postMessage('copy:' + text);
      done();
      return;
    }

    if (legacy()) {
      done();
      return;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        showToast('复制失败');
      });
      return;
    }

    showToast('复制失败');
  }

  function setQuote(msg, session) {
    const who = msg.from === 'me' ? (state.user.name || '我') : session.name;
    const text = msg.kind === 'voice' ? '[语音] ' + msg.duration + '"' : msg.text;
    state.quote = { who: who, text: text };
    renderQuoteBar();
    const input = document.getElementById('chatInput');
    if (input) input.focus();
  }

  function renderQuoteBar() {
    const bar = document.getElementById('quoteBar');
    if (!bar) return;
    const q = state.quote;
    bar.hidden = !q;
    if (!q) return;
    setText('quoteWho', q.who);
    setText('quoteBody', q.text);
  }

  function deleteMessage(index) {
    const session = activeSession();
    if (index < 0 || index >= session.messages.length) return;
    session.messages.splice(index, 1);
    if (state.selected.indexOf(index) !== -1) state.selected = [];
    saveState();
    renderChat();
    showToast('已删除');
  }

  /* ---------------- 多选 ---------------- */

  function enterSelect(index) {
    state.selectMode = true;
    state.selected = typeof index === 'number' ? [index] : [];
    if (state.quote) {
      state.quote = null;
      renderQuoteBar();
    }
    renderChat();
  }

  function exitSelect() {
    state.selectMode = false;
    state.selected = [];
    renderChat();
  }

  function toggleSelect(index) {
    const at = state.selected.indexOf(index);
    if (at === -1) state.selected.push(index);
    else state.selected.splice(at, 1);
    renderChat();
  }

  function updateSelectBar() {
    const bar = document.getElementById('selectBar');
    const composer = document.querySelector('.composer');
    if (!bar) return;

    const on = !!state.selectMode;
    bar.hidden = !on;
    if (composer) composer.hidden = on;

    const count = document.getElementById('selectCount');
    const del = document.getElementById('selectDel');
    if (count) count.textContent = '已选 ' + state.selected.length + ' 条';
    if (del) del.disabled = !state.selected.length;
  }

  function deleteSelected() {
    if (!state.selected.length) return;
    const session = activeSession();
    state.selected
      .slice()
      .sort(function (a, b) { return b - a; })
      .forEach(function (idx) { session.messages.splice(idx, 1); });
    const n = state.selected.length;
    state.selected = [];
    state.selectMode = false;
    saveState();
    renderChat();
    showToast('已删除 ' + n + ' 条');
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
          showToast(item.label + ' · 暂未开发');
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

  /* ---- 真录音：拿麦克风 → MediaRecorder → dataURL 存在消息里 ---- */
  let micStream = null;
  let micRecorder = null;
  let micChunks = [];
  let micAsk = null;

  function askMicPermission() {
    if (micAsk) return micAsk;
    micAsk = new Promise(function (resolve) {
      if (!window.DshNative) {
        resolve(true); /* 浏览器里直接让 getUserMedia 自己弹权限 */
        return;
      }
      window.DshMicAnswer = function (ok) { resolve(!!ok); };
      try {
        window.DshNative.postMessage('requestMic');
      } catch (err) {
        resolve(true);
      }
      window.setTimeout(function () { resolve(true); }, 4000);
    });
    return micAsk;
  }

  async function beginAudioCapture() {
    if (!navigator.mediaDevices || !window.MediaRecorder) return;

    await askMicPermission();

    try {
      if (!micStream) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
    } catch (err) {
      showToast('没有麦克风权限，只能发一个空语音');
      return;
    }

    micChunks = [];
    let options;
    try {
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        options = { mimeType: 'audio/webm;codecs=opus' };
      }
    } catch (err) {
      options = undefined;
    }

    try {
      micRecorder = new MediaRecorder(micStream, options);
      micRecorder.ondataavailable = function (event) {
        if (event.data && event.data.size) micChunks.push(event.data);
      };
      micRecorder.start();
    } catch (err) {
      micRecorder = null;
    }
  }

  function finishAudioCapture() {
    return new Promise(function (resolve) {
      if (!micRecorder || micRecorder.state === 'inactive') {
        resolve(null);
        return;
      }
      const finish = function () {
        micRecorder = null;
        if (!micChunks.length) {
          resolve(null);
          return;
        }
        const blob = new Blob(micChunks, { type: micChunks[0].type || 'audio/webm' });
        micChunks = [];
        if (!blob.size) {
          resolve(null);
          return;
        }
        const reader = new FileReader();
        reader.onload = function () { resolve(String(reader.result)); };
        reader.onerror = function () { resolve(null); };
        reader.readAsDataURL(blob);
      };

      micRecorder.onstop = finish;
      try {
        micRecorder.stop();
      } catch (err) {
        resolve(null);
      }
    });
  }

  let playingAudio = null;

  function playVoice(msg, bubble) {
    if (!msg.audio) {
      showToast('这条语音没录上（旧版本发的）');
      return;
    }

    if (playingAudio) {
      playingAudio.pause();
      playingAudio = null;
      document.querySelectorAll('.bubble-voice.is-playing').forEach(function (node) {
        node.classList.remove('is-playing');
      });
    }

    const audio = new Audio(msg.audio);
    playingAudio = audio;
    bubble.classList.add('is-playing');

    const clear = function () {
      bubble.classList.remove('is-playing');
      if (playingAudio === audio) playingAudio = null;
    };

    audio.onended = clear;
    audio.onerror = function () {
      clear();
      showToast('播放失败');
    };
    audio.play().catch(function () {
      clear();
      showToast('播放失败');
    });
  }

  function startRecording(event) {
    if (rec) return;
    if (event && event.cancelable) event.preventDefault();

    rec = { start: Date.now(), y: event ? event.clientY : 0, cancel: false, timer: null };
    beginAudioCapture();

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
      finishAudioCapture();
      showToast('说话时间太短');
      return;
    }

    const seconds = Math.max(1, Math.round(raw));
    const session = activeSession();
    finishAudioCapture().then(function (audio) {
      pushMine(session, { kind: 'voice', duration: seconds, audio: audio || undefined });
    });
  }

  /* ---- 测试用的固定回复：发什么都回同一段，延迟 0.9s 模拟对方在打字 ---- */

  /* 「她说完了没有」：发出去之后先显示"正在输入…"，她回话就停 */
  let waitTimer = null;
  let waitingSession = null;

  let typingNow = false;

  function isOnline() {
    return navigator.onLine !== false;
  }

  /** 现在到底连没连上：先看有没有网，再看管道通不通 */
  function connectionLabel() {
    if (!isOnline()) return '离线';
    const st = state.pipeStatus;
    if (st === 'online') return '在线';
    if (st === 'checking') return '连接中…';
    return '未连接';
  }

  /** 首页 / 朋友圈那两处「在线」，跟聊天头部同一套判定 */
  function paintConnection() {
    const 文 = connectionLabel();
    const off = 文 !== '在线';

    ['homeOnlineText', 'momentsOnlineText'].forEach(function (id) {
      const node = document.getElementById(id);
      if (node) node.textContent = 文;
    });
    ['momentsOnline'].forEach(function (id) {
      const box = document.getElementById(id);
      if (box) box.classList.toggle('is-off', off);
    });
    const homeBox = document.getElementById('homeOnlineText');
    if (homeBox && homeBox.parentElement) homeBox.parentElement.classList.toggle('is-off', off);

    refreshChatStatus();
  }

  /* 状态行：正在输入 > 离线 > 在线 */
  function refreshChatStatus() {
    const node = document.getElementById('chatStatusText');
    if (!node) return;
    const 文 = typingNow ? '正在输入…' : connectionLabel();
    node.textContent = 文;
    node.classList.toggle('is-offline', !typingNow && 文 !== '在线');
  }

  /** 去管道问一句「你在不在」，顺便把各处状态刷新一遍 */
  async function checkPipeStatus() {
    const cfg = readPipeConfig();
    if (!cfg.base) {
      state.pipeStatus = 'unset';
      paintConnection();
      return 'unset';
    }

    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? window.setTimeout(function () { ctl.abort(); }, 5000) : null;
    try {
      const res = await fetch(cfg.base + '/info', {
        headers: { 'X-DSH-Token': cfg.token || '' },
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined,
      });
      state.pipeStatus = res.ok ? 'online' : 'offline';
    } catch (err) {
      state.pipeStatus = 'offline';
    } finally {
      if (timer) window.clearTimeout(timer);
    }
    paintConnection();
    return state.pipeStatus;
  }

  /* 每 15 秒问一次；回到前台立刻补一次 */
  function startPipeWatch() {
    if (pipeWatchTimer) return;
    checkPipeStatus();
    pipeWatchTimer = window.setInterval(checkPipeStatus, 15000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkPipeStatus();
    });
    window.addEventListener('online', function () { checkPipeStatus(); });
    window.addEventListener('offline', function () {
      state.pipeStatus = 'offline';
      paintConnection();
    });
  }
  let pipeWatchTimer = null;

  /* ==========================================================
     收消息：每 2 秒去管道问一次「有没有她新说的话」
     游标存在 localStorage，管道重启（epoch 变了）就归零重来。
     ========================================================== */
  const PIPE_CURSOR_KEY = 'dsh.pipe.cursor';
  let pipePollTimer = null;
  let pipePolling = false;

  function readPipeCursor() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(PIPE_CURSOR_KEY) || '{}');
      return { epoch: String(raw.epoch || ''), since: Number(raw.since) || 0 };
    } catch (err) {
      return { epoch: '', since: 0 };
    }
  }

  function writePipeCursor(cur) {
    try {
      window.localStorage.setItem(PIPE_CURSOR_KEY, JSON.stringify(cur));
    } catch (err) {
      /* 存不下就下次重来，最多重复一条 */
    }
  }

  /** 管道收到的消息进哪间会话：就是「小鱼」这间 */
  function pipeTargetSession() {
    for (let i = 0; i < SESSIONS.length; i++) {
      if (SESSIONS[i].id === 'xiaoyu') return SESSIONS[i];
    }
    return SESSIONS[0];
  }

  async function pollPipeMessages() {
    if (pipePolling) return;
    const cfg = readPipeConfig();
    if (!cfg.base || !cfg.token) return;

    pipePolling = true;
    const cur = readPipeCursor();
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? window.setTimeout(function () { ctl.abort(); }, 6000) : null;

    try {
      const res = await fetch(cfg.base + '/messages?role=app&since=' + cur.since, {
        headers: { 'X-DSH-Token': cfg.token },
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined,
      });
      if (!res.ok) return;

      const data = await res.json().catch(function () { return {}; });
      if (data.epoch && data.epoch !== cur.epoch) {
        cur.epoch = String(data.epoch);
        cur.since = 0;
      }

      const list = Array.isArray(data.messages) ? data.messages : [];
      let 变了 = false;
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        const seq = Number(m && m.seq) || 0;
        if (seq <= cur.since) continue;
        cur.since = seq;
        变了 = true;
        if (!m || m.from !== 'dsh') continue;
        receiveHer(pipeTargetSession(), m.text);
      }
      if (变了 || data.epoch) writePipeCursor(cur);
    } catch (err) {
      /* 连不上就安静跳过，下一跳再试 */
    } finally {
      if (timer) window.clearTimeout(timer);
      pipePolling = false;
    }
  }

  function startPipePoll() {
    if (pipePollTimer) return;
    pollPipeMessages();
    pipePollTimer = window.setInterval(pollPipeMessages, 2000);
  }

  function restartPipePoll() {
    if (pipePollTimer) {
      window.clearInterval(pipePollTimer);
      pipePollTimer = null;
    }
    startPipePoll();
  }

  function setTyping(on) {
    typingNow = !!on;
    refreshChatStatus();
  }

  /* 发完等回复：显示"正在输入…"，最多等 120 秒 */
  function startWaiting(session) {
    if (waitTimer) window.clearTimeout(waitTimer);
    waitingSession = session;
    if (activeSession() === session) setTyping(true);
    waitTimer = window.setTimeout(function () {
      waitTimer = null;
      waitingSession = null;
      setTyping(false);
    }, 120000);
  }

  function stopWaiting() {
    if (waitTimer) window.clearTimeout(waitTimer);
    waitTimer = null;
    waitingSession = null;
    setTyping(false);
  }

  /** 把她的一句话放进会话（管道收上来的唯一入口） */
  function receiveHer(session, text) {
    const 文 = String(text || '').trim();
    if (!文) return;

    session.messages.push({ from: 'her', text: 文, time: nowTime(), state: 'ok' });
    stopWaiting();

    const 正在看 = activeSession() === session && document.visibilityState !== 'hidden';
    if (正在看) {
      saveState();
      renderChat();
      scrollChatToBottom();
      return;
    }

    session.unread = true;
    session.unreadCount = (session.unreadCount || 0) + 1;
    saveState();
    renderSessions();

    if (document.visibilityState === 'hidden') {
      notifyUser(session.name, 文.slice(0, 80));
    }
  }

  /** 把一条气泡发到管道；失败就打 failed（红色感叹号，点一下重发） */
  async function pipeSendMessage(session, msg) {
    const cfg = readPipeConfig();
    if (!cfg.base || !cfg.token) {
      msg.state = 'failed';
      saveState();
      renderChat();
      showToast('还没连上管道，去「服务连接」里填地址和令牌');
      return false;
    }

    msg.state = 'sending';
    renderChat();

    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? window.setTimeout(function () { ctl.abort(); }, 10000) : null;
    try {
      const res = await fetch(cfg.base + '/say', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-DSH-Token': cfg.token },
        body: JSON.stringify({ from: 'app', text: msg.text }),
        signal: ctl ? ctl.signal : undefined,
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);

      msg.state = 'ok';
      saveState();
      renderChat();
      startWaiting(session);
      return true;
    } catch (err) {
      msg.state = 'failed';
      saveState();
      renderChat();
      showToast('没发出去：' + (err && err.name === 'AbortError' ? '超时' : String((err && err.message) || err)));
      return false;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  /* 离线时消息照样落到列表里，但带 failed 状态（红色感叹号，点一下重发） */
  function pushMine(session, extra) {
    const msg = Object.assign(
      { from: 'me', text: '', time: nowTime(), state: isOnline() ? 'ok' : 'failed' },
      extra
    );
    session.messages.push(msg);
    saveState();
    renderChat();
    scrollChatToBottom();

    if (session.type === 'peer') {
      /* 发到局域网的另一台设备，不模拟回复 */
      peerSend(msg.text).then(function (ok) {
        if (!ok) {
          msg.state = 'failed';
          renderChat();
        }
      });
      return msg;
    }

    if (msg.kind === 'voice') {
      /* 语音暂时只在本地：管道只传文字 */
      msg.state = 'ok';
      saveState();
      showToast('语音还发不出去（管道只传文字）');
      return msg;
    }

    pipeSendMessage(session, msg);
    return msg;
  }

  function retryMessage(session, msg) {
    if (!isOnline()) {
      showToast('还是没有网络，等一下再试');
      return;
    }
    pipeSendMessage(session, msg);
  }

  function sendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;

    const quote = state.quote;
    input.value = '';
    state.quote = null;
    renderQuoteBar();

    pushMine(activeSession(), quote ? { text: text, quote: quote } : { text: text });
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

    const isSub = page === 'settings' || page === 'editprofile' || page === 'chatdetail' || page === 'link' || page === 'newchat';
    document.getElementById('phone').classList.toggle('is-sub', isSub);

    if (page !== 'chatdetail') {
      voiceOpen(false);
      plusOpen(false);
    }

    /* 离开页面时收起悬浮菜单；离开聊天页还要退出多选与引用 */
    closePopMenu();
    if (page !== 'chatdetail') {
      if (state.selectMode) {
        state.selectMode = false;
        state.selected = [];
        updateSelectBar();
      }
      if (state.quote) {
        state.quote = null;
        renderQuoteBar();
      }
    }

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
    if (page === 'chat') {
      /* 数据没变就复用已经渲染好的 DOM，不重建、不重新解码头像 */
      if (sessionsSignature() !== sessionsSig) renderSessions();
    }
    if (page === 'chatdetail') {
      if (chatSignature(activeSession()) !== chatSig) renderChat();
      scrollChatToBottom();

      if (activeSession().type === 'peer') {
        if (!peerAddress()) {
          askText({
            title: '填电脑的地址',
            hint: '电脑上要开着 serve.py',
            value: '',
            placeholder: '例如 10.184.48.28:8080',
            onDone: function (answer) {
              if (!answer) return;
              setPeerAddress(answer);
              showToast('地址已保存');
              peerStart();
            },
          });
        } else {
          peerStart();
        }
      }
    }
    if (page === 'editprofile') fillEditForm();

    const scroller = document.querySelector('.page.is-active .scroller');
    if (scroller) scroller.scrollTop = 0;
  }

  /* ==========================================================
     十、事件绑定
     ========================================================== */

  /* ---------------- 自绘输入弹层 ----------------
     为什么不用 window.prompt：它是系统对话框，在 WebView 里弹出时有一段过渡动画，
     滚动/键盘弹出时明显掉帧，而且样式完全改不了。这里 display 一变就直接到位。 */
  let askDone = null;

  function askText(options) {
    const layer = document.getElementById('askLayer');
    const hint = document.getElementById('askHint');
    const input = document.getElementById('askInput');
    if (!layer || !input) return;

    setText('askTitle', options.title || '');
    if (options.hint) {
      hint.hidden = false;
      setText('askHint', options.hint);
    } else {
      hint.hidden = true;
    }

    input.value = options.value || '';
    input.placeholder = options.placeholder || '';
    input.type = options.password ? 'password' : 'text';

    askDone = options.onDone || null;
    layer.hidden = false;
    input.focus();
    try {
      input.setSelectionRange(0, input.value.length);
    } catch (err) {
      /* 某些输入法不支持，忽略 */
    }
  }

  function closeAsk(value) {
    const layer = document.getElementById('askLayer');
    if (!layer || layer.hidden) return;
    layer.hidden = true;

    const cb = askDone;
    askDone = null;

    const input = document.getElementById('askInput');
    if (input) input.blur();

    if (cb) cb(value);
  }

  function bindAskLayer() {
    const layer = document.getElementById('askLayer');
    if (!layer) return;

    layer.addEventListener('click', function (event) {
      const target = event.target.closest('[data-ask]');
      if (!target) return;
      if (target.dataset.ask === 'ok') {
        const input = document.getElementById('askInput');
        closeAsk(input ? input.value.trim() : '');
      } else {
        closeAsk(null);
      }
    });

    const input = document.getElementById('askInput');
    if (input) {
      input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          closeAsk(input.value.trim());
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeAsk(null);
        }
      });
    }
  }

  /* ==========================================================
     检查更新
     原生那边只做三件事：查版本、下载、拉起安装器；
     界面（发现新版本 / 进度 / 失败）都在网页里画，跟整套配色一致。
     ========================================================== */
  let updBusy = false;

  function paintUpdateProgress(percent) {
    const prog = document.getElementById('updProgress');
    const bar = document.getElementById('updBar');
    const txt = document.getElementById('updPercent');
    const actions = document.getElementById('updActions');

    const p = Math.max(0, Math.min(1, Number(percent) || 0));
    if (prog) prog.hidden = false;
    if (actions) actions.hidden = true;
    if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
    if (txt) {
      txt.textContent = p <= 0
        ? '准备中…'
        : (p >= 1 ? '下载完成，正在打开安装界面…' : Math.round(p * 100) + '%');
    }
    updBusy = true;
  }

  function openUpdateLayer(info) {
    const layer = document.getElementById('updateLayer');
    if (!layer) return;

    setText('updTitle', '发现新版本 ' + (info.version || ''));
    setText('updSub', '当前 ' + (info.current || '') + (info.size ? ' · 安装包 ' + info.size : ''));

    const notes = document.getElementById('updNotes');
    if (notes) notes.textContent = info.notes || '这次没写更新说明，装上就知道了。';

    const prog = document.getElementById('updProgress');
    if (prog) prog.hidden = true;
    const bar = document.getElementById('updBar');
    if (bar) bar.style.width = '0%';
    const actions = document.getElementById('updActions');
    if (actions) actions.hidden = false;

    updBusy = false;
    layer.hidden = false;
  }

  function closeUpdateLayer() {
    const layer = document.getElementById('updateLayer');
    if (layer) layer.hidden = true;
    updBusy = false;
  }

  /* 原生回调入口：checking / latest / error / available / progress / done / fail */
  window.DshUpdate = function (kind, data) {
    data = data || {};

    if (kind === 'checking') {
      showToast('正在检查更新…');
      return;
    }
    if (kind === 'latest') {
      showToast('已是最新版本' + (data.version ? ' ' + data.version : ''));
      return;
    }
    if (kind === 'error') {
      showToast(data.message || '检查更新失败，请检查网络');
      return;
    }
    if (kind === 'available') {
      openUpdateLayer(data);
      return;
    }
    if (kind === 'progress') {
      paintUpdateProgress(data.percent);
      return;
    }
    if (kind === 'done') {
      closeUpdateLayer();
      showToast('下载完成，正在打开安装界面…');
      return;
    }
    if (kind === 'fail') {
      closeUpdateLayer();
      showToast(data.message || '更新失败，稍后再试');
    }
  };

  function bindUpdateLayer() {
    const layer = document.getElementById('updateLayer');
    if (!layer) return;

    layer.addEventListener('click', function (event) {
      const target = event.target.closest('[data-upd]');
      if (!target) return;

      if (target.dataset.upd === 'now') {
        if (updBusy) return;
        paintUpdateProgress(0);
        if (window.DshNative && window.DshNative.postMessage) {
          window.DshNative.postMessage('updateDownload');
        } else {
          closeUpdateLayer();
          showToast('网页预览里不下载安装包');
        }
        return;
      }

      /* 下载中不许关，避免进度丢了用户以为没在下载 */
      if (updBusy) return;
      closeUpdateLayer();
    });
  }


  /* ==========================================================
     服务连接：管道地址 + 令牌
     这一步只把地址存下来、试连一次；真正收发要等聊天那边接上管道。
     ========================================================== */
  const PIPE_BASE_KEY = 'dsh.pipe.base';
  const PIPE_TOKEN_KEY = 'dsh.pipe.token';

  function readPipeConfig() {
    let base = '';
    let token = '';
    try {
      base = window.localStorage.getItem(PIPE_BASE_KEY) || '';
      token = window.localStorage.getItem(PIPE_TOKEN_KEY) || '';
    } catch (err) {
      /* 隐私模式读不了，当空的 */
    }
    return { base: base, token: token };
  }

  function normalizePipeBase(raw) {
    const v = String(raw || '').trim().replace(/\/+$/, '');
    if (!v) return '';
    return /^https?:\/\//i.test(v) ? v : 'http://' + v;
  }

  function paintPipeState(kind, text) {
    const el = document.getElementById('pipeState');
    if (!el) return;
    el.className = 'conn-state' + (kind === 'ok' ? ' is-ok' : kind === 'bad' ? ' is-bad' : '');
    el.textContent = text;
  }

  function fillPipePage() {
    const cfg = readPipeConfig();
    const base = document.getElementById('pipeBase');
    const token = document.getElementById('pipeToken');
    if (base) base.value = cfg.base;
    if (token) token.value = cfg.token;
    paintPipeState('', cfg.base ? '还没连过，点一下「测试连接」' : '还没连接');
    if (cfg.base) checkPipeStatus();
  }

  async function testPipe() {
    const cfg = readPipeConfig();
    if (!cfg.base) {
      paintPipeState('bad', '先填管道地址');
      return false;
    }
    if (!cfg.token) {
      paintPipeState('bad', '先填令牌');
      return false;
    }

    paintPipeState('', '正在连…');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? window.setTimeout(function () { ctl.abort(); }, 6000) : null;

    try {
      /* 用 /info 而不是 /health：它要令牌，正好验证令牌对不对 */
      const res = await fetch(cfg.base + '/info', {
        headers: { 'X-DSH-Token': cfg.token },
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined,
      });
      if (!res.ok) {
        paintPipeState(
          'bad',
          '连上了但被拒绝：HTTP ' + res.status + (res.status === 401 ? '（令牌不对）' : ''),
        );
        state.pipeStatus = 'offline';
        paintConnection();
        return false;
      }
      const data = await res.json().catch(function () { return {}; });
      paintPipeState('ok', '✓ 已连接 · 队列到 #' + String(data.last == null ? '?' : data.last));
      state.pipeStatus = 'online';
      paintConnection();
      return true;
    } catch (err) {
      const 名 = err && err.name === 'AbortError' ? '超时' : String((err && err.message) || err);
      paintPipeState('bad', '连不上：' + 名);
      state.pipeStatus = 'offline';
      paintConnection();
      return false;
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  function savePipeConfig() {
    const baseEl = document.getElementById('pipeBase');
    const tokenEl = document.getElementById('pipeToken');
    const base = normalizePipeBase(baseEl ? baseEl.value : '');
    const token = (tokenEl ? tokenEl.value : '').trim();
    try {
      window.localStorage.setItem(PIPE_BASE_KEY, base);
      window.localStorage.setItem(PIPE_TOKEN_KEY, token);
    } catch (err) {
      /* 存不下就算了，别炸 */
    }
    if (baseEl) baseEl.value = base;
    return { base: base, token: token };
  }

  function bindPipePage() {
    const row = document.getElementById('serviceLinkRow');
    if (row) {
      row.addEventListener('click', function () {
        fillPipePage();
        go('link');
      });
    }

    const save = document.getElementById('pipeSave');
    if (save) {
      save.addEventListener('click', function () {
        const cfg = savePipeConfig();
        if (!cfg.base || !cfg.token) {
          paintPipeState('bad', '地址和令牌都要填');
          return;
        }
        showToast('地址已保存，正在连接…');
        testPipe();
      });
    }

    const test = document.getElementById('pipeTest');
    if (test) {
      test.addEventListener('click', function () {
        testPipe();
      });
    }
  }


  /* ==========================================================
     创建聊天：右上角 + 下拉（创建聊天 / 创建群聊）
     ========================================================== */
  let newChatAvatar = '';

  function paintNewChatAvatar() {
    const box = document.getElementById('newChatAvatar');
    const hint = document.getElementById('newChatAvatarHint');
    if (!box) return;
    if (newChatAvatar) {
      box.classList.add('has-image');
      box.style.backgroundImage = 'url("' + newChatAvatar + '")';
      if (hint) hint.textContent = '点一下换一张';
    } else {
      box.classList.remove('has-image');
      box.style.backgroundImage = '';
      if (hint) hint.textContent = '点一下上传头像';
    }
  }

  function pickNewChatAvatar(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function () {
      const raw = reader.result;
      const img = new Image();

      img.onload = function () {
        /* 头像小，压到 160px 就够，别把存档撑大 */
        const max = 160;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        try {
          newChatAvatar = canvas.toDataURL('image/jpeg', 0.86);
        } catch (err) {
          newChatAvatar = raw;
        }
        paintNewChatAvatar();
      };

      img.onerror = function () {
        newChatAvatar = raw;
        paintNewChatAvatar();
      };

      img.src = raw;
    };

    reader.readAsDataURL(file);
  }

  function fillNewChatPage() {
    newChatAvatar = '';
    const nameEl = document.getElementById('newChatName');
    if (nameEl) nameEl.value = '';
    paintNewChatAvatar();
  }

  function createChat() {
    const nameEl = document.getElementById('newChatName');
    const name = (nameEl ? nameEl.value : '').trim();
    if (!name) {
      showToast('先给它起个名字');
      return;
    }

    const session = {
      id: 'friend-' + Date.now(),
      name: name,
      type: 'friend',
      custom: true,
      avatar: newChatAvatar || name.slice(0, 1),
      pinned: false,
      starred: false,
      unread: false,
      unreadCount: 0,
      messages: [],
    };
    SESSIONS.push(session);

    /* 建完回「全部」，免得当前筛在群聊上以为没建成 */
    state.sessionFilter = 'all';
    document.querySelectorAll('.seg-btn[data-session]').forEach(function (btn) {
      const on = btn.dataset.session === 'all';
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    newChatAvatar = '';
    if (nameEl) nameEl.value = '';
    paintNewChatAvatar();

    saveState();
    renderSessions();
    showToast('建好了：' + name);
    go('chat');
  }

  function bindNewChat() {
    const plus = document.getElementById('newChatBtn');
    if (plus) {
      plus.addEventListener('click', function () {
        openPopMenu(
          plus,
          [
            { key: 'chat', label: '创建聊天' },
            { key: 'group', label: '创建群聊' },
          ],
          function (key) {
            if (key === 'group') {
              showToast('建群 · 暂未开发');
              return;
            }
            fillNewChatPage();
            go('newchat');
          },
        );
      });
    }

    const avatarBtn = document.getElementById('newChatAvatar');
    const fileInput = document.getElementById('newChatFile');
    if (avatarBtn && fileInput) {
      avatarBtn.addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        pickNewChatAvatar(fileInput.files && fileInput.files[0]);
        fileInput.value = '';
      });
    }

    const create = document.getElementById('newChatCreate');
    if (create) create.addEventListener('click', createChat);

    const cancel = document.getElementById('newChatCancel');
    if (cancel) {
      cancel.addEventListener('click', function () {
        go('chat');
      });
    }
  }


  /* ==========================================================
     扫一扫
     电脑上插件「绑定」页点「显示二维码」，内容是：
       dshpipe:1?b=<地址>&t=<令牌>
     扫到就自动填进上面两格，然后顺手连一次。
     ========================================================== */
  let scanStream = null;
  let scanRaf = 0;

  function parsePipePayload(text) {
    const raw = String(text || '').trim();
    if (!raw) return null;

    if (raw.indexOf('dshpipe:') === 0) {
      const q = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?') + 1) : '';
      const parts = q.split('&');
      const 取 = function (key) {
        for (let i = 0; i < parts.length; i++) {
          const kv = parts[i].split('=');
          if (decodeURIComponent(kv[0] || '') === key) {
            return decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
          }
        }
        return '';
      };
      const base = 取('b');
      if (base) return { base: base, token: 取('t') };
    }

    /* 兜底：扫到的是个普通网址，就当管道地址用 */
    if (/^https?:\/\//i.test(raw)) return { base: raw, token: '' };
    return null;
  }

  function stopScan() {
    if (scanRaf) {
      window.cancelAnimationFrame(scanRaf);
      scanRaf = 0;
    }
    if (scanStream) {
      try {
        scanStream.getTracks().forEach(function (t) { t.stop(); });
      } catch (err) {
        /* ignore */
      }
      scanStream = null;
    }
    const video = document.getElementById('scanVideo');
    if (video) {
      try { video.srcObject = null; } catch (err) { /* ignore */ }
    }
  }

  function closeScan() {
    stopScan();
    const layer = document.getElementById('scanLayer');
    if (layer) layer.hidden = true;
  }

  function applyScanned(text) {
    const 结果 = parsePipePayload(text);
    if (!结果) {
      showToast('这不是鲸与鱼的二维码');
      return;
    }

    const baseEl = document.getElementById('pipeBase');
    const tokenEl = document.getElementById('pipeToken');
    const base = normalizePipeBase(结果.base);
    if (baseEl) baseEl.value = base;
    if (tokenEl && 结果.token) tokenEl.value = 结果.token;

    savePipeConfig();

    if (!结果.token) {
      paintPipeState('bad', '地址扫到了，令牌还得手填（或者让电脑显示完整二维码）');
      return;
    }
    showToast('扫到了，正在连接…');
    testPipe();
  }

  function scanLoop() {
    const video = document.getElementById('scanVideo');
    const canvas = document.getElementById('scanCanvas');
    if (!video || !canvas) return;

    const tick = function () {
      if (!scanStream) return;

      if (video.readyState === 4 && video.videoWidth) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        try {
          const img = ctx.getImageData(0, 0, w, h);
          const code = window.jsQR ? window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' }) : null;
          if (code && code.data) {
            closeScan();
            applyScanned(code.data);
            return;
          }
        } catch (err) {
          /* 单帧解不出来很正常，继续下一帧 */
        }
      }

      scanRaf = window.requestAnimationFrame(tick);
    };

    tick();
  }

  async function openScan() {
    const layer = document.getElementById('scanLayer');
    const video = document.getElementById('scanVideo');
    const tip = document.getElementById('scanTip');
    if (!layer || !video) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('这个环境不支持相机（真机上才行）');
      return;
    }
    if (!window.jsQR) {
      showToast('扫码组件没加载上');
      return;
    }

    layer.hidden = false;
    if (tip) tip.textContent = '在电脑上打开 DSH → 设置 → 鲸与鱼 → 绑定 → 显示二维码';

    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = scanStream;
      await video.play();
      scanLoop();
    } catch (err) {
      if (tip) {
        tip.textContent = '打不开相机：' + String((err && err.message) || err) + '（手机要在系统里给相机权限）';
      }
    }
  }

  function bindScan() {
    const btn = document.getElementById('pipeScan');
    if (btn) {
      btn.addEventListener('click', function () {
        openScan();
      });
    }
    const cancel = document.getElementById('scanCancel');
    if (cancel) cancel.addEventListener('click', closeScan);
  }

  function bindEvents() {
    bindAskLayer();
    bindUpdateLayer();
    bindPipePage();
    bindNewChat();
    bindScan();
    startPipeWatch();
    startPipePoll();

    /* App 里：等原生桥挂好，按存档里的开关状态把服务拉起来 */
    let bgTries = 0;
    (function bootBackgroundPoll() {
      if (syncBackgroundPoll() || bgTries >= 4) return;
      bgTries += 1;
      window.setTimeout(bootBackgroundPoll, 700);
    })();

    document.querySelectorAll('.tab-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        go(btn.dataset.tab);
      });
    });

    /* 聊天头部的状态行：peer 会话里点一下能改地址 / 重连 */
    const statusLine = document.getElementById('chatStatus');
    if (statusLine) {
      statusLine.addEventListener('click', function () {
        if (activeSession().type !== 'peer') return;
        askText({
          title: '电脑地址',
          hint: '留空表示断开连接',
          value: peerAddress() || '192.168.1.5:8080',
          onDone: function (answer) {
            if (answer === null) return;
            setPeerAddress(answer);
            peerStop();
            if (answer) {
              peer.since = 0;
              peerStart();
              showToast('正在连接 ' + answer);
            } else {
              peer.online = false;
              paintPeerStatus();
              showToast('已断开');
            }
          },
        });
      });
    }

    /* 测试通知 / 去系统设置 */
    /* 后台推送总开关：App 里真正启停原生前台服务 */
    const bgToggle = document.getElementById('bgDelivery');
    if (bgToggle) {
      bgToggle.checked = !!state.bgDelivery;
      bgToggle.addEventListener('change', function () {
        state.bgDelivery = !!bgToggle.checked;
        saveState();

        if (!state.bgDelivery) {
          syncBackgroundPoll();
          showToast('已关闭后台接收');
          return;
        }

        ensureNotifyPermission();

        if (!peerAddress()) {
          showToast('先在「我的电脑」里填电脑地址');
          return;
        }
        if (!syncBackgroundPoll()) {
          showToast('浏览器里收不到后台通知，装 App 才行');
          return;
        }
        showToast('已开启：关掉 App 也会收到通知');
      });
    }

    const batteryBtn = document.getElementById('batteryBtn');
    if (batteryBtn) {
      batteryBtn.addEventListener('click', function () {
        if (window.DshNative) {
          window.DshNative.postMessage('openAppSettings');
        } else {
          showToast('浏览器里请在系统设置里手动放行');
        }
      });
    }

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

    /* 毛玻璃（backdrop-filter）在移动端很贵：App 里、或核数很少的设备上关掉，
       浏览器保持原样，方便你对比 */
    const cores = navigator.hardwareConcurrency || 4;
    if (ENV_APP || cores <= 4) {
      document.documentElement.classList.add('low-fx');
    }

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

    /* 浏览器专用：全屏隐藏地址栏。必须用户手势触发，所以挂成按钮（App 里这一行不显示） */
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) {
      const isFull = function () {
        return !!(document.fullscreenElement || document.webkitFullscreenElement);
      };

      const paintLabel = function () {
        fullscreenBtn.textContent = isFull() ? '退出全屏' : '全屏';
      };

      fullscreenBtn.addEventListener('click', function () {
        if (isFull()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) exit.call(document);
          return;
        }
        const el = document.documentElement;
        const request = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!request) {
          fullscreenBtn.textContent = '不支持';
          return;
        }
        const ret = request.call(el);
        if (ret && ret.catch) {
          ret.catch(function () {
            fullscreenBtn.textContent = '不支持';
          });
        }
      });

      document.addEventListener('fullscreenchange', paintLabel);
      document.addEventListener('webkitfullscreenchange', paintLabel);
      paintLabel();
    }

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
    /* 多选操作条 */
    const selectCancel = document.getElementById('selectCancel');
    if (selectCancel) selectCancel.addEventListener('click', exitSelect);

    const selectDel = document.getElementById('selectDel');
    if (selectDel) selectDel.addEventListener('click', deleteSelected);

    /* 引用条：取消引用 */
    const quoteClose = document.getElementById('quoteClose');
    if (quoteClose) {
      quoteClose.addEventListener('click', function () {
        state.quote = null;
        renderQuoteBar();
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

    /* 切后台 / 关页面时把没落盘的存档写掉 */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushSave();
    });
    window.addEventListener('pagehide', flushSave);

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
    paintVersion();
    startSlotTimer();
    warmImages();
    if (peerAddress()) peerStart();

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
