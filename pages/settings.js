// 설정 창: 바꾸는 즉시 저장한다 (메인 프로세스가 값을 검증해 돌려준다)
(() => {
  const api = window.desktop && window.desktop.settings;
  if (!api) return;

  const switches = document.querySelectorAll("input.switch[data-key]");
  const segments = document.querySelectorAll(".segment[data-key]");
  const updateButton = document.getElementById("update");
  const updateStatus = document.getElementById("update-status");
  let readyVersion = null;

  // —— 업무 알림: 서버 설정이라 목록 창(웹)이 대신 읽고 바꾼다 (0.5.3+) ——
  const accountSection = document.getElementById("account");
  const accountRows = document.getElementById("account-rows");
  const accountStatus = document.getElementById("account-status");
  const ACCOUNT_KINDS = [
    { key: "approval", label: "결재", help: "결재 요청·승인·반려·참조, 경비·구매 처리" },
    { key: "mail", label: "메일", help: "새 메일·반송" },
    { key: "general", label: "그 밖의 알림", help: "일정·회의·근태 수정 등" },
  ];
  const ACCOUNT_REASONS = {
    unavailable: "목록 창에서 로그인하면 바꿀 수 있습니다.",
    timeout: "응답이 없습니다. 설정 창을 닫았다가 다시 열어 주세요.",
    failed: "바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };
  /** { prefs: {approval, mail, general, personalMail}, email, mailboxes: [{id, address, displayName, pushEnabled}] } */
  let account = null;
  let accountBusy = false;
  let deviceNotify = true;

  function accountRow({ label, help, checked, disabled, nested, onChange }) {
    const row = document.createElement("label");
    row.className = `row${nested ? " row--nested" : ""}${disabled ? " is-disabled" : ""}`;
    const text = document.createElement("span");
    text.textContent = label;
    if (help) {
      const small = document.createElement("small");
      small.textContent = help;
      text.append(small);
    }
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "switch";
    input.checked = checked;
    input.disabled = disabled;
    input.addEventListener("change", () => onChange(input.checked));
    row.append(text, input);
    return row;
  }

  function renderAccount() {
    accountRows.replaceChildren();
    if (!account) return;
    const { prefs, email, mailboxes } = account;
    const off = !deviceNotify || accountBusy;
    for (const kind of ACCOUNT_KINDS) {
      accountRows.append(
        accountRow({
          label: kind.label,
          help: kind.help,
          checked: Boolean(prefs[kind.key]),
          disabled: off,
          onChange: (on) => void changePrefs({ [kind.key]: on }),
        }),
      );
      if (kind.key !== "mail") continue;
      const addressOff = off || !prefs.mail;
      accountRows.append(
        accountRow({
          label: email || "내 메일",
          help: "내 메일",
          checked: Boolean(prefs.personalMail),
          disabled: addressOff,
          nested: true,
          onChange: (on) => void changePrefs({ personalMail: on }),
        }),
      );
      for (const box of mailboxes) {
        accountRows.append(
          accountRow({
            label: box.address,
            help: box.displayName ? `공용 · ${box.displayName}` : "공용",
            checked: Boolean(box.pushEnabled),
            disabled: addressOff,
            nested: true,
            onChange: (on) => void changeMailbox(box.id, on),
          }),
        );
      }
    }
  }

  async function callAccount(action, payload) {
    const result = await api.account(action, payload).catch(() => null);
    if (!result || !result.ok) {
      accountStatus.textContent = ACCOUNT_REASONS[result && result.reason] || ACCOUNT_REASONS.failed;
      return null;
    }
    accountStatus.textContent = "";
    return result.data;
  }

  async function changePrefs(patch) {
    accountBusy = true;
    renderAccount();
    const prefs = await callAccount("update", patch);
    if (prefs && account) account = { ...account, prefs };
    accountBusy = false;
    renderAccount();
  }

  async function changeMailbox(id, enabled) {
    accountBusy = true;
    renderAccount();
    const saved = await callAccount("mailbox", { id, enabled });
    if (saved && account) {
      account = {
        ...account,
        mailboxes: account.mailboxes.map((box) => (box.id === saved.id ? { ...box, pushEnabled: saved.pushEnabled } : box)),
      };
    }
    accountBusy = false;
    renderAccount();
  }

  if (typeof api.account === "function") {
    accountStatus.textContent = "불러오는 중…";
    void callAccount("get").then((data) => {
      account = data;
      renderAccount();
    });
  } else {
    accountSection.hidden = true;
  }

  function render(values) {
    deviceNotify = Boolean(values.notify);
    renderAccount();
    for (const input of switches) input.checked = Boolean(values[input.dataset.key]);
    for (const segment of segments) {
      const current = String(values[segment.dataset.key]);
      for (const button of segment.querySelectorAll("button")) {
        const active = button.dataset.value === current;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
        button.setAttribute("role", "radio");
      }
    }
    for (const row of document.querySelectorAll("[data-depends]")) {
      const enabled = Boolean(values[row.dataset.depends]);
      row.classList.toggle("is-disabled", !enabled);
      row.querySelector("input").disabled = !enabled;
    }
  }

  async function save(patch) {
    const values = await api.set(patch);
    if (values) render(values);
  }

  for (const input of switches) {
    input.addEventListener("change", () => void save({ [input.dataset.key]: input.checked }));
  }
  for (const segment of segments) {
    for (const button of segment.querySelectorAll("button")) {
      button.addEventListener("click", () => {
        const raw = button.dataset.value;
        void save({ [segment.dataset.key]: raw === "true" || raw === "false" ? raw === "true" : Number(raw) });
      });
    }
  }

  function showReady(version) {
    readyVersion = version;
    updateStatus.textContent = `새 버전 ${version}이 준비됐습니다.`;
    updateButton.textContent = "다시 시작해 적용";
    updateButton.classList.add("action--primary");
  }

  const UPDATE_MESSAGES = {
    dev: "개발 실행에서는 업데이트를 확인하지 않습니다.",
    latest: "최신 버전입니다.",
    error: "업데이트를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  };

  updateButton.addEventListener("click", async () => {
    if (readyVersion) {
      api.installUpdate();
      return;
    }
    updateButton.disabled = true;
    updateStatus.textContent = "확인하는 중…";
    const result = await api.checkUpdate();
    updateButton.disabled = false;
    if (!result) return;
    if (result.state === "ready") showReady(result.version);
    else if (result.state === "downloading") {
      updateStatus.textContent = `새 버전 ${result.version}을 내려받는 중입니다. 끝나면 알림으로 알려 드립니다.`;
    } else updateStatus.textContent = UPDATE_MESSAGES[result.state] || "";
  });

  api.get().then((values) => {
    if (!values) return;
    document.getElementById("version").textContent = values.version;
    render(values);
    if (values.readyUpdateVersion) showReady(values.readyUpdateVersion);
  });
})();
