// Consent card for a chat-app connection request (SK-MCP-02 piece 1).
// The request can arrive through a link someone else sent, so the card says which app started it,
// requires the person to confirm they just started it themselves, and asks again before the
// manage scope. Only the server's structured fields (client_name, redirect_host, scopes) are used.

const SCOPE_LABELS = Object.freeze({
  'sidekick.read': '이 프로젝트의 작업·결과 읽기',
  'sidekick.work': '확인한 일과 진행·제작 견적 준비',
  'sidekick.manage': '작업 수정 준비·중단 요청',
});
const SECOND_STEP_SCOPE = 'sidekick.manage';

export function consentModel(request) {
  const name = String(request.client_name || '');
  const scopes = Array.isArray(request.scopes) ? request.scopes : [];
  return Object.freeze({
    title: `${name}에서 시작한 연결 요청`,
    returnLine: request.redirect_host ? `허용하면 ${request.redirect_host}(으)로 돌아가요.` : '',
    warning: `방금 ${name}에서 직접 연결을 누른 경우에만 허용하세요. 다른 사람이 보낸 링크라면 '연결하지 않기'를 눌러 주세요.`,
    confirmLabel: `내가 방금 ${name}에서 사이드킥 연결을 시작했어요`,
    scopeLines: Object.freeze(scopes.map((scope) => SCOPE_LABELS[scope] || scope)),
    needsSecondStep: scopes.includes(SECOND_STEP_SCOPE),
    secondStepText: `이 앱은 ${SCOPE_LABELS[SECOND_STEP_SCOPE]} 권한도 요청했어요. 이 권한까지 허용할까요?`,
  });
}

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text || '';
  return node;
}

function button(text) {
  const node = element('button', text);
  node.type = 'button';
  return node;
}

export function renderConsent(root, request, projects, actions) {
  const model = consentModel(request);
  const first = element('div');
  const second = element('div');
  second.hidden = true;

  const scopes = element('ul');
  for (const line of model.scopeLines) scopes.append(element('li', line));

  const projectLabel = element('label', '함께 사용할 프로젝트');
  projectLabel.htmlFor = 'project';
  const select = element('select');
  select.id = 'project';
  for (const project of projects.workspaces || []) {
    const option = element('option', project.name || project.id);
    option.value = project.id;
    select.append(option);
  }

  const confirmRow = element('div');
  confirmRow.className = 'consent-check';
  const confirm = element('input');
  confirm.type = 'checkbox';
  confirm.id = 'consent-confirm';
  confirm.checked = false;
  const confirmLabel = element('label', model.confirmLabel);
  confirmLabel.htmlFor = 'consent-confirm';
  confirmRow.append(confirm, confirmLabel);

  const approve = button('이 프로젝트에 연결');
  const deny = button('연결하지 않기');
  const secondText = element('p', model.secondStepText);
  secondText.className = 'consent-warning';
  const approveAll = button('모두 허용하고 연결');
  const back = button('돌아가기');
  const buttons = [approve, deny, approveAll, back];

  let busy = false;
  function sync() {
    for (const node of buttons) node.disabled = busy;
    if (!confirm.checked) approve.disabled = true;
  }
  function showFirst() {
    second.hidden = true;
    first.hidden = false;
    confirm.checked = false;
    sync();
  }
  async function decide(approved) {
    if (busy) return;
    busy = true;
    sync();
    try { await actions.decide(select.value, approved); } finally { busy = false; sync(); }
  }

  confirm.addEventListener('change', sync);
  approve.addEventListener('click', async () => {
    if (busy || !confirm.checked) return;
    if (model.needsSecondStep) { first.hidden = true; second.hidden = false; return; }
    await decide(true);
  });
  approveAll.addEventListener('click', () => decide(true));
  back.addEventListener('click', showFirst);
  deny.addEventListener('click', () => decide(false));

  const warning = element('p', model.warning);
  warning.className = 'consent-warning';
  first.append(projectLabel, select, confirmRow, approve);
  second.append(secondText, approveAll, back);
  root.replaceChildren(element('h2', model.title));
  if (model.returnLine) root.append(element('p', model.returnLine));
  root.append(warning, scopes, first, second, deny);
  showFirst();
}
