// 로컬 화면의 창 버튼 (data-window-action="minimize" | "close")
(() => {
  const controls = window.desktop && window.desktop.windowControls;
  if (!controls) return;
  for (const button of document.querySelectorAll("[data-window-action]")) {
    button.addEventListener("click", () => {
      if (button.dataset.windowAction === "minimize") controls.minimize();
      else controls.close();
    });
  }
  const applyState = (state) => document.body.classList.toggle("is-blurred", Boolean(state) && !state.focused);
  controls.getState().then(applyState);
  controls.onStateChange(applyState);
})();
