import { renderCard, safeHttps } from './view.js';
// The public guide works before sign-in and never calls an account API.
function initConnectionGuide() {
  const list = document.getElementById('guide-tabs');
  if (!list) return;
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  function select(tab, focus = false) {
    for (const candidate of tabs) {
      const active = candidate === tab;
      candidate.setAttribute('aria-selected', String(active));
      candidate.tabIndex = active ? 0 : -1;
      const panel = document.getElementById(candidate.getAttribute('aria-controls'));
      panel.hidden = !active;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', candidate.id);
      panel.tabIndex = 0;
    }
    document.getElementById('guide-copy-status').textContent = '';
    if (focus) { tab.focus(); tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault(); select(tabs[next], true);
    });
  }
  const fragment = location.hash.slice(1);
  select(tabs.find((tab) => tab.getAttribute('aria-controls') === fragment) || tabs[0]);
  list.hidden = false;
  for (const copy of document.querySelectorAll('[data-copy-address]')) {
    copy.hidden = false;
    copy.addEventListener('click', async () => {
      const input = copy.closest('.guide-address').querySelector('input');
      const status = document.getElementById('guide-copy-status');
      try {
        await navigator.clipboard.writeText(input.value);
        status.textContent = '연결 주소를 복사했어요.';
      } catch {
        input.focus(); input.select();
        status.textContent = '자동 복사가 안 돼 주소를 선택했어요. 직접 복사해 주세요.';
      }
    });
  }
}
initConnectionGuide();
const auth = window.SidekickAuth;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let generation = 0, activeJob = null;
const id = (key) => /^[A-Za-z0-9_-]{1,160}$/.test(params.get(key) || '') ? params.get(key) : '';
function fail() { $('notice').textContent = '확인하지 못했어요. 로그인과 연결 상태를 확인한 뒤 다시 시도해 주세요.'; }
function open(url) { const valid = safeHttps(url); if (valid) location.assign(valid); }
function element(tag, text) { const n = document.createElement(tag); n.textContent = text || ''; return n; }
function button(text, action) {
  const n = element('button', text); n.type = 'button';
  n.addEventListener('click', async () => { n.disabled = true; try { await action(); } catch { fail(); } finally { n.disabled = false; } }); return n;
}
function session() { return { generation, token: auth.token() }; }
function current(s) { return s.generation === generation && s.token && s.token === auth.token(); }
async function api(path, options = {}, s = session()) {
  if (!current(s)) throw new Error('session_changed');
  const answer = await auth.api(path, { ...options, headers: { Authorization: 'Bearer ' + s.token } });
  if (!current(s)) throw new Error('session_changed');
  return answer;
}
function post(path, body, s) { return api(path, { method: 'POST', body: JSON.stringify(body) }, s); }
function show(data) {
  $('card').hidden = false;
  renderCard($('card'), data, { open, refresh: async () => activeJob ? loadJob(activeJob) : boot() });
}
async function loadJob(job) {
  const s = session(), data = await api('/assistant/jobs/' + job, {}, s); activeJob = job; show(data);
  $('media').replaceChildren();
  for (const media of data.media_jobs || []) {
    const root = element('section'); root.className = 'card';
    root.append(element('h2', media.status === 'quote' ? '제작 조건 확인' : '제작 상태'), element('p', media.service_label || '연결한 제작 서비스'), element('p', ({quote:'제작 조건 확인',queued:'접수됨',processing:'제작 중',storing:'결과 저장 중',completed:'완료',failed:'확인 필요',cancelled:'중단됨',uncertain:'제작 서비스 확인 중'})[media.status] || '제작 상태 확인 중'));
    if (media.status === 'quote') {
      root.append(element('p', media.estimated_credits == null ? '선택을 마친 뒤 견적을 확인해 주세요.' : '예상 사용량: ' + media.estimated_credits));
      for (const choice of media.choices || []) {
        root.append(button(choice.name || choice.label || choice.voice_name || choice.voice_id || choice.id, async () => {
          await post('/media/jobs/' + media.job_id + '/actions', { workspace_id: data.workspace_id, action: 'select', choice_id: choice.voice_id || choice.id, slot: choice.slot, action_id: 'ma_' + crypto.randomUUID().replaceAll('-', '') }, s);
          await loadJob(job);
        }));
      }
      if (media.ui_type === 'emotion_picker') {
        const picks = [];
        for (const [index, line] of (media.lines || []).entries()) {
          const label = element('label', `${index + 1}번째 문장 · ${line}`);
          const select = element('select'); select.setAttribute('aria-label', `${index + 1}번째 문장 감정`);
          for (const emotion of media.emotions || []) { const option = element('option', emotion); option.value = emotion; select.append(option); }
          picks.push(select); label.append(select); root.append(label);
        }
        root.append(button('감정 선택 마치기', async () => {
          await post('/media/jobs/' + media.job_id + '/actions', { workspace_id: data.workspace_id, action: 'select', emotions: picks.map((select) => select.value), action_id: 'ma_' + crypto.randomUUID().replaceAll('-', '') }, s);
          await loadJob(job);
        }));
      }
      if (media.ui_type === 'frame_upload') {
        root.append(element('p', '프로젝트에 저장한 자료를 골라 주세요. 새 자료는 Sidekick 앱에서 올린 뒤 상태를 갱신해 주세요.'));
        root.append(button('선택한 자료로 견적 확인', async () => {
          await post('/media/jobs/' + media.job_id + '/actions', { workspace_id: data.workspace_id, action: 'frames_done', action_id: 'ma_' + crypto.randomUUID().replaceAll('-', '') }, s);
          await loadJob(job);
        }));
      }
      if (media.estimated_credits != null) root.append(button('이 조건과 사용량으로 제작', async () => {
        await post('/media/jobs/' + media.job_id + '/actions', { workspace_id: data.workspace_id, action: 'execute', quote_version: media.quote_version, action_id: 'ma_' + media.job_id.replaceAll('-', '_') + '_v' + media.quote_version }, s);
        await loadJob(job);
      }));
    }
    for (const asset of media.result || []) { if (safeHttps(asset.url)) root.append(button(asset.name || '결과물 열기', () => open(asset.url))); }
    $('media').append(root);
  }
}
async function boot() {
  generation += 1; activeJob = null;
  for (const key of ['connect', 'card', 'grants']) $(key).hidden = true;
  $('media').replaceChildren(); $('notice').textContent = '';
  if (!auth.token()) { $('notice').textContent = 'Sidekick 앱과 같은 계정으로 로그인해 주세요.'; return; }
  const s = session();
  try {
    if (id('connect')) {
      const [request, projects] = await Promise.all([api('/assistant/oauth/requests/' + id('connect'), {}, s), api('/workspaces/ai-engine-targets', {}, s)]);
      $('client-name').textContent = request.client_name + ' 연결';
      const labels = { 'sidekick.read': '이 프로젝트의 작업·결과 읽기', 'sidekick.work': '확인한 일과 진행·제작 견적 준비', 'sidekick.manage': '작업 수정 준비·중단 요청' };
      $('scope-copy').textContent = request.scopes.map((v) => labels[v] || v).join(' · ');
      $('project').replaceChildren();
      for (const project of projects.workspaces || []) { const n = element('option', project.name || project.id); n.value = project.id; $('project').append(n); }
      $('connect').hidden = false;
    } else if (id('prepare')) {
      const data = await api('/assistant/preparations/' + id('prepare'), {}, s); show(data);
      $('card').append(button('이 조건으로 일과 진행 허용', async () => {
        await post('/assistant/preparations/' + id('prepare') + '/decision', { approve: true }, s);
        $('notice').textContent = '확인했어요. 연결한 AI 채팅으로 돌아가 일과를 시작해 주세요.';
      }));
    } else if (id('job')) await loadJob(id('job'));
    const grants = await api('/assistant-grants', {}, s); $('grant-list').replaceChildren();
    for (const grant of grants.filter((g) => !g.revoked_at)) {
      const row = element('p', (grant.client_name || '연결한 AI 앱') + ' · ' + (grant.workspace_name || '프로젝트'));
      row.append(button('연결 해제', async () => { await api('/assistant-grants/' + grant.id, { method: 'DELETE' }, s); await boot(); })); $('grant-list').append(row);
    }
    $('grants').hidden = false;
  } catch { if (current(s)) fail(); }
}
for (const [name, approve] of [['allow', true], ['deny', false]]) {
  $(name).addEventListener('click', async () => {
    const s = session(); $('allow').disabled = $('deny').disabled = true;
    try {
      const result = await post('/assistant/oauth/requests/' + id('connect') + '/decision', { workspace_id: $('project').value, approve }, s);
      open(result.redirect_url);
    } catch { fail(); } finally { $('allow').disabled = $('deny').disabled = false; }
  });
}
// Consent pages cannot be embedded by an external client to solicit a hidden click.
if (window.top !== window.self) { document.body.hidden = true; }
else auth.init({ onSignedIn: boot, onSignedOut: boot, onNotice: (text) => { $('notice').textContent = text; } }).then(boot).catch(fail);
