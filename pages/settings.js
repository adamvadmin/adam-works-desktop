// 설정 창: 바꾸는 즉시 저장한다 (메인 프로세스가 값을 검증해 돌려준다)
(() => {
  const api = window.desktop && window.desktop.settings;
  if (!api) return;

  const switches = document.querySelectorAll("input.switch[data-key]");
  const segments = document.querySelectorAll(".segment[data-key]");
  const updateButton = document.getElementById("update");
  const updateStatus = document.getElementById("update-status");
  let readyVersion = null;

  function render(values) {
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
