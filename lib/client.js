/**
 * dsh-budget 的浏览器半侧：侧边栏「预算」入口 + 整页配置面板。
 *
 * 束契约（抄 dsh-skill-mcp-panel/lib/client.js）：本文件由宿主以
 * `/plugins/dsh-budget/client.js` 提供，只能 require 外壳种子词
 * （react、jsx-runtime、primitives），所以这里手写 createElement、不编译 JSX。
 *
 * 数据一律走自己插件的 HTTP 路由（同源 fetch），不碰 remote/typert 网关：
 * 少一层清单就少一处版本耦合。
 */
window.__ModuleLoader__.load({
    id: 'dsh-budget',
    factory: (require) => {
        const bundleModule = { exports: {} };
        Object.defineProperty(bundleModule.exports, Symbol.toStringTag, { value: 'Module' });

        const react = require('react');
        const h = react.createElement;

        /** 侧栏行 id / 主区 key，两处必须一致（宿主选中缺失 key 会直接抛错）。 */
        const PANEL_ID = 'budget';
        /** 本插件路由前缀。 */
        const BASE = '/plugins/dsh-budget';
        /** 轮询间隔：额度是钱，5 秒够用。 */
        const POLL_MS = 5000;

        const NS = 'dsh-budget';

        // ── 样式 ────────────────────────────────────────────────────────────
        // 颜色只走宿主 token（--dsw-alias-*），深/浅主题自动跟随。
        const CSS = [
            '.BGD_page{box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;gap:18px;padding:24px clamp(20px,4vw,44px) 44px;overflow:auto;color:var(--dsw-alias-label-primary)}',
            '.BGD_page>*{width:100%;max-width:680px}',
            '.BGD_top{display:flex;align-items:center;gap:10px;min-height:20px}',
            '.BGD_back{font:inherit;font-size:12.5px;line-height:20px;color:var(--dsw-alias-label-tertiary);background:0 0;border:0;padding:0;cursor:pointer;display:inline-flex;align-items:center;gap:6px}',
            '.BGD_back:hover{color:var(--dsw-alias-label-primary)}',
            '.BGD_head{display:flex;flex-direction:column;gap:4px}',
            '.BGD_title{margin:0;font-size:20px;font-weight:500;line-height:28px}',
            '.BGD_intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
            '.BGD_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:12px}',
            '.BGD_cardHead{display:flex;align-items:center;gap:8px}',
            '.BGD_cardTitle{margin:0;font-size:13px;font-weight:600;line-height:20px;flex:1;min-width:0}',
            '.BGD_badge{font-size:11px;line-height:16px;padding:1px 8px;border-radius:999px;white-space:nowrap;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}',
            '.BGD_badge[data-kind=ok]{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 12%, transparent);color:var(--dsw-alias-state-success-primary)}',
            '.BGD_badge[data-kind=warn]{background:color-mix(in srgb, var(--dsw-alias-state-warning-primary) 14%, transparent);color:var(--dsw-alias-state-warning-primary)}',
            '.BGD_badge[data-kind=stop]{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);color:var(--dsw-alias-state-error-primary)}',
            '.BGD_money{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
            '.BGD_moneyMain{font-size:28px;line-height:36px;font-weight:500;font-variant-numeric:tabular-nums}',
            '.BGD_moneySub{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
            '.BGD_bar{position:relative;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
            '.BGD_barFill{position:absolute;inset:0 auto 0 0;border-radius:999px;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}',
            '.BGD_barFill[data-kind=warn]{background:var(--dsw-alias-state-warning-primary)}',
            '.BGD_barFill[data-kind=stop]{background:var(--dsw-alias-state-error-primary)}',
            '.BGD_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}',
            '.BGD_kv{display:flex;flex-direction:column;gap:2px}',
            '.BGD_kvLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            '.BGD_kvValue{font-size:13px;line-height:20px;font-variant-numeric:tabular-nums}',
            '.BGD_field{display:flex;flex-direction:column;gap:6px}',
            '.BGD_fieldLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.BGD_row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
            '.BGD_input{box-sizing:border-box;width:140px;height:32px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;padding:0 10px}',
            '.BGD_input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent)}',
            '.BGD_btn{box-sizing:border-box;height:32px;font:inherit;font-size:13px;line-height:30px;padding:0 14px;border-radius:8px;cursor:pointer;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
            '.BGD_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
            '.BGD_btn:disabled{opacity:.55;cursor:default}',
            '.BGD_btn[data-primary=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent;color:var(--dsw-alias-state-business-on-primary,#fff)}',
            '.BGD_btn[data-danger=true]{color:var(--dsw-alias-state-error-primary)}',
            '.BGD_switchRow{display:flex;align-items:flex-start;gap:10px;cursor:pointer}',
            '.BGD_switch{box-sizing:border-box;width:36px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);position:relative;flex:none;padding:0;cursor:pointer;transition:background-color .2s ease,border-color .2s ease}',
            '.BGD_switch[data-on=true]{background:var(--dsw-alias-state-business-primary);border-color:transparent}',
            '.BGD_thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .2s ease,background-color .2s ease}',
            '.BGD_switch[data-on=true] .BGD_thumb{transform:translateX(16px);background:#fff}',
            '.BGD_switchText{display:flex;flex-direction:column;gap:2px;min-width:0}',
            '.BGD_switchTitle{font-size:13px;line-height:20px}',
            '.BGD_switchHint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            '.BGD_status{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);margin:0}',
            '.BGD_error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary);margin:0}',
            '.BGD_icon{display:inline-block;flex:none;background-color:currentColor;-webkit-mask:var(--BGD_glyph) center/contain no-repeat;mask:var(--BGD_glyph) center/contain no-repeat}',
        ].join('');

        /** 侧栏字形：一枚带尾巴（鲸鱼尾）的硬币，线稿风，跟宿主图标同粗细。 */
        const GLYPH =
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' width='96' height='96' fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><circle cx='22' cy='22' r='13'/><path d='M18 17h6.5a4.5 4.5 0 0 1 0 9H18z'/><path d='M18 17v14'/><path d='M33 32c4 0 6-2 7-5'/></svg>\")";

        function ensureStyles() {
            if (typeof document === 'undefined' || document === null) return;
            if (document.getElementById('dsh-budget-style') !== null) return;
            const style = document.createElement('style');
            style.id = 'dsh-budget-style';
            style.textContent = CSS + '.BGD_icon{--BGD_glyph:' + GLYPH + '}';
            document.head.appendChild(style);
        }

        function PanelIcon({ size }) {
            ensureStyles();
            const px = typeof size === 'number' && size > 0 ? size : 16;
            return h('span', { className: 'BGD_icon', style: { width: px + 'px', height: px + 'px' } });
        }

        // ── 宿主接口 ────────────────────────────────────────────────────────
        async function request(path, init) {
            const res = await fetch(BASE + path, {
                credentials: 'same-origin',
                headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
                ...init,
            });
            const text = await res.text();
            let data = null;
            try {
                data = text.length > 0 ? JSON.parse(text) : null;
            } catch {
                data = null;
            }
            if (!res.ok || data === null) {
                const reason = data?.reason ?? 'http-' + res.status;
                throw new Error(reason);
            }
            return data;
        }

        const money = (value, currency) => {
            const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
            return n.toFixed(Math.abs(n) < 100 ? 2 : 0) + ' ' + (currency ?? 'CNY');
        };

        const pctOf = (plan) => {
            const value = typeof plan?.remainingPercent === 'number' ? plan.remainingPercent : 0;
            return Math.max(0, Math.min(100, value));
        };

        const barKind = (plan, gate, lowPercent) => {
            if (gate?.disabled) return 'stop';
            if (plan?.overBudget) return 'stop';
            if (typeof plan?.remainingPercent === 'number' && plan.remainingPercent <= (lowPercent ?? 10)) return 'warn';
            return 'ok';
        };

        /** 「3 分钟前」这种相对时间，账单同步用。 */
        const since = (ms) => {
            if (typeof ms !== 'number' || ms <= 0) return '还没同步过';
            const diff = Date.now() - ms;
            if (diff < 60_000) return '刚刚';
            if (diff < 3_600_000) return Math.round(diff / 60_000) + ' 分钟前';
            if (diff < 86_400_000) return Math.round(diff / 3_600_000) + ' 小时前';
            return Math.round(diff / 86_400_000) + ' 天前';
        };

        const badgeOf = (gate) => {
            if (gate?.disabled) return { kind: 'stop', text: '已停用' };
            if (gate?.pending) return { kind: 'warn', text: '本轮结束后停用' };
            if (gate?.allowTurn) return { kind: 'warn', text: '已放行一轮' };
            if (gate?.autoDisable) return { kind: 'ok', text: '监控中' };
            return { kind: '', text: '仅提醒' };
        };

        function Kv({ label, value }) {
            return h('div', { className: 'BGD_kv' }, [
                h('div', { className: 'BGD_kvLabel', key: 'l' }, label),
                h('div', { className: 'BGD_kvValue', key: 'v' }, value),
            ]);
        }

        function Switch({ on, title, hint, disabled, onToggle }) {
            return h(
                'div',
                { className: 'BGD_switchRow' },
                h('button', {
                    type: 'button',
                    className: 'BGD_switch',
                    'data-on': on === true,
                    role: 'switch',
                    'aria-checked': on === true,
                    disabled: disabled === true,
                    onClick: () => onToggle(on !== true),
                }, h('span', { className: 'BGD_thumb' })),
                h('div', { className: 'BGD_switchText' }, [
                    h('div', { className: 'BGD_switchTitle', key: 't' }, title),
                    hint === undefined ? null : h('div', { className: 'BGD_switchHint', key: 'h' }, hint),
                ]),
            );
        }

        // ── 面板主体 ────────────────────────────────────────────────────────
        function BudgetPanel(props) {
            const backToConversation = props?.backToConversation;
            const [data, setData] = react.useState(null);
            const [error, setError] = react.useState(null);
            const [busy, setBusy] = react.useState(false);
            const [draft, setDraft] = react.useState('');
            const [notice, setNotice] = react.useState(null);

            ensureStyles();

            const load = react.useCallback(async () => {
                try {
                    const next = await request('/status', { method: 'GET' });
                    setData(next);
                    setError(null);
                    return next;
                } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                    return null;
                }
            }, []);

            react.useEffect(() => {
                void load();
                const timer = setInterval(() => {
                    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
                    void load();
                }, POLL_MS);
                return () => clearInterval(timer);
            }, [load]);

            const plan = data?.plan ?? null;
            const config = data?.config ?? null;
            const gate = data?.gate ?? null;
            const billing = data?.billing ?? null;
            const bill = billing ?? { enabled: true, intervalMinutes: 15, balance: null, currency: 'CNY', lastSyncMs: 0, error: '' };

            react.useEffect(() => {
                if (config !== null && draft === '') setDraft(String(config.monthlyQuota));
            }, [config, draft]);

            const patch = async (body, okText) => {
                setBusy(true);
                setNotice(null);
                try {
                    const result = await request('/config', { method: 'POST', body: JSON.stringify(body) });
                    if (result?.plan) {
                        setData((prev) => (prev === null ? prev : { ...prev, plan: result.plan, config: result.config, gate: result.gate ?? prev.gate }));
                    }
                    setNotice(okText);
                    await load();
                } catch (e) {
                    setNotice('保存失败：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            const action = async (path, okText) => {
                setBusy(true);
                setNotice(null);
                try {
                    await request(path, { method: 'POST', body: '{}' });
                    setNotice(okText);
                    await load();
                } catch (e) {
                    setNotice('失败：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            const headline = plan === null ? '读不到计费状态' : money(Math.max(0, plan.remaining), plan.currency);
            const badge = badgeOf(gate);
            const kind = barKind(plan, gate, config?.lowPercent);

            return h('div', { className: 'BGD_page' }, [
                h('div', { className: 'BGD_top', key: 'top' },
                    typeof backToConversation === 'function'
                        ? h('button', { type: 'button', className: 'BGD_back', onClick: () => backToConversation() }, '← 返回对话')
                        : null),
                h('div', { className: 'BGD_head', key: 'head' }, [
                    h('h1', { className: 'BGD_title', key: 't' }, '预算'),
                    h('p', { className: 'BGD_intro', key: 'i' }, '月额度摊到工作日，没花完的自动滚到后面几天；剩 10% 和 0% 时桌宠会提醒。'),
                ]),

                // 今天
                h('div', { className: 'BGD_card', key: 'today' }, [
                    h('div', { className: 'BGD_cardHead', key: 'h' }, [
                        h('h2', { className: 'BGD_cardTitle', key: 't' }, '今天还能花'),
                        h('span', { className: 'BGD_badge', 'data-kind': badge.kind, key: 'b' }, badge.text),
                    ]),
                    h('div', { className: 'BGD_money', key: 'm' }, [
                        h('span', { className: 'BGD_moneyMain', key: 'a' }, headline),
                        h('span', { className: 'BGD_moneySub', key: 'b' },
                            plan === null ? '' : '已用 ' + money(plan.spentToday, plan.currency) + ' / 可用 ' + money(plan.availableToday, plan.currency)),
                    ]),
                    h('div', { className: 'BGD_bar', key: 'bar' },
                        h('span', { className: 'BGD_barFill', 'data-kind': kind, style: { width: pctOf(plan) + '%' } })),
                    h('div', { className: 'BGD_grid', key: 'grid' }, [
                        h(Kv, { key: 'd', label: '剩余比例', value: plan === null ? '—' : plan.remainingPercent + '%' }),
                        h(Kv, { key: 'w', label: '今天', value: plan === null ? '—' : (plan.isWorkday ? '工作日' : '休息日') }),
                        h(Kv, { key: 'n', label: '本月已花', value: plan === null ? '—' : money(plan.spentMonth, plan.currency) }),
                    ]),
                    error === null ? null : h('p', { className: 'BGD_error', key: 'e' }, '读状态失败：' + error + '（插件没启？）'),
                ]),

                // 本月
                h('div', { className: 'BGD_card', key: 'month' }, [
                    h('div', { className: 'BGD_cardHead', key: 'h' }, h('h2', { className: 'BGD_cardTitle' }, '本月')),
                    h('div', { className: 'BGD_grid', key: 'g' }, [
                        h(Kv, { key: 'q', label: '月额度', value: plan === null ? '—' : money(plan.monthlyQuota, plan.currency) }),
                        h(Kv, { key: 'w', label: '工作日', value: plan === null ? '—' : plan.totalWorkdays + ' 天（已过 ' + plan.elapsedWorkdays + '）' }),
                        h(Kv, { key: 'a', label: '日均', value: plan === null ? '—' : money(plan.dailyAverage, plan.currency) }),
                        h(Kv, { key: 'r', label: '月剩余', value: plan === null ? '—' : money(plan.monthRemaining, plan.currency) }),
                    ]),
                ]),

                // 账单同步（平台用量接口 = 真账单）
                h('div', { className: 'BGD_card', key: 'bill' }, [
                    h('div', { className: 'BGD_cardHead', key: 'h' }, [
                        h('h2', { className: 'BGD_cardTitle', key: 't' }, '平台账单'),
                        h('span', {
                            className: 'BGD_badge',
                            'data-kind': bill.error ? 'warn' : (bill.source === 'usage' ? 'ok' : (typeof bill.balance === 'number' ? 'ok' : '')),
                            key: 'b',
                        }, bill.error ? '同步失败' : (bill.source === 'usage' ? '真实账单' : (typeof bill.balance === 'number' ? '余额记账' : '未同步'))),
                    ]),
                    h('div', { className: 'BGD_grid', key: 'g' }, [
                        h(Kv, {
                            key: 'month',
                            label: '本月已花（账单）',
                            value: typeof bill.monthTotal === 'number' && bill.monthTotal > 0 ? money(bill.monthTotal, bill.currency) : '—',
                        }),
                        h(Kv, {
                            key: 'today',
                            label: '今天已花（账单）',
                            value: typeof bill.todayCost === 'number' ? money(bill.todayCost, bill.currency) : '—',
                        }),
                        h(Kv, {
                            key: 'bal',
                            label: 'DeepSeek 余额',
                            value: typeof bill.balance === 'number' ? money(bill.balance, bill.currency) : '—',
                        }),
                        h(Kv, {
                            key: 'src',
                            label: '数据来源',
                            value: bill.source === 'usage' ? '平台用量接口（按天）' : '余额差记账',
                        }),
                        h(Kv, {
                            key: 'days',
                            label: '本月账单天数',
                            value: plan === null ? '—' : (plan.billedDays ?? 0) + ' 天（其余按估算）',
                        }),
                        h(Kv, { key: 'last', label: '上次同步', value: since(bill.lastSyncMs) }),
                    ]),
                    bill.error ? h('p', { className: 'BGD_status', key: 'err' }, bill.error) : null,
                    h(Switch, {
                        key: 'sw',
                        on: bill.enabled !== false,
                        title: '账单同步',
                        hint: '每 ' + (bill.intervalMinutes ?? 15) + ' 分钟拉一次平台用量接口，拿当月每天的消费金额（拿不到就退回余额差记账）。',
                        disabled: busy,
                        onToggle: (next) => void patch({ billSync: next }, next ? '账单同步已打开' : '账单同步已关闭，改回本地估算'),
                    }),
                    h('div', { className: 'BGD_row', key: 'acts' }, [
                        h('button', {
                            key: 'sync',
                            type: 'button',
                            className: 'BGD_btn',
                            disabled: busy || bill.enabled === false,
                            onClick: () => void action('/sync', '已同步平台账单'),
                        }, '立即同步'),
                    ]),
                ]),

                // 配置
                h('div', { className: 'BGD_card', key: 'config' }, [
                    h('div', { className: 'BGD_cardHead', key: 'h' }, h('h2', { className: 'BGD_cardTitle' }, '设置')),
                    h('div', { className: 'BGD_field', key: 'quota' }, [
                        h('label', { className: 'BGD_fieldLabel', key: 'l' }, '每月额度（' + (config?.currency ?? 'CNY') + '）'),
                        h('div', { className: 'BGD_row', key: 'r' }, [
                            h('input', {
                                key: 'i',
                                className: 'BGD_input',
                                inputMode: 'decimal',
                                value: draft,
                                placeholder: '300',
                                onChange: (event) => setDraft(event.target.value),
                            }),
                            h('button', {
                                key: 'b',
                                type: 'button',
                                className: 'BGD_btn',
                                'data-primary': true,
                                disabled: busy || !/^\d+(\.\d+)?$/.test(draft.trim()),
                                onClick: () => void patch({ monthlyQuota: Number(draft.trim()) }, '额度已更新'),
                            }, '保存'),
                        ]),
                    ]),
                    h(Switch, {
                        key: 'sw',
                        on: config?.autoDisable === true,
                        title: '超额就停用',
                        hint: '当天额度用尽后拦住模型调用；正在跑的任务等它跑完再停。',
                        disabled: busy,
                        onToggle: (next) => void patch({ autoDisable: next }, next ? '已开启：超额自动停用' : '已关闭自动停用'),
                    }),
                    h(Switch, {
                        key: 'sw2',
                        on: config?.remind !== false,
                        title: '桌宠提醒',
                        hint: '剩 ' + (config?.lowPercent ?? 10) + '% 和 0% 时让宠物出气泡。',
                        disabled: busy,
                        onToggle: (next) => void patch({ remind: next }, next ? '提醒已打开' : '提醒已关掉'),
                    }),
                    h('div', { className: 'BGD_row', key: 'acts' }, [
                        h('button', {
                            key: 'once',
                            type: 'button',
                            className: 'BGD_btn',
                            disabled: busy || gate?.disabled !== true,
                            onClick: () => void action('/allow-once', '放行一轮：这轮跑完再停'),
                        }, '再用一次'),
                        h('button', {
                            key: 'resume',
                            type: 'button',
                            className: 'BGD_btn',
                            'data-danger': true,
                            disabled: busy || (gate?.disabled !== true && gate?.pending !== true),
                            onClick: () => void action('/resume', '今天不再自动停用'),
                        }, '今天恢复'),
                    ]),
                    notice === null ? null : h('p', { className: 'BGD_status', key: 'n' }, notice),
                    h('p', { className: 'BGD_status', key: 'foot' },
                        plan === null ? '' : '状态每小时自动复核；配置写在 ' + '%DSH_HOME%' + '\\budget.json。'),
                ]),
            ]);
        }

        /** 绑定宿主：侧栏一行 + 中央主区整页。 */
        function apply(ctx) {
            ensureStyles();
            // 返回对话：layout 是宿主 shell 提供的软依赖，取不到就当空操作。
            const backToConversation = () => {
                try {
                    const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined;
                    if (layout !== null && layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(null);
                } catch {
                    /* 没有 layout 的宿主少一个返回按钮，不影响面板 */
                }
            };
            try {
                ctx.slots.inject('sidebar.panellist', () =>
                    ctx.slots.register(
                        { name: 'sidebar.panellist', id: PANEL_ID, order: 2, label: () => '预算' },
                        PanelIcon,
                    ),
                );
            } catch (e) {
                console.error('[dsh-budget] 侧栏入口注册失败：', e);
            }
            try {
                ctx.slots.inject('main', () =>
                    ctx.slots.register(
                        { name: 'main', key: PANEL_ID, inject: () => ({ backToConversation }) },
                        BudgetPanel,
                    ),
                );
            } catch (e) {
                console.error('[dsh-budget] 主区页面注册失败：', e);
            }
        }

        bundleModule.exports.apply = apply;
        bundleModule.exports.inject = ['slots'];
        bundleModule.exports.NS = NS;
        return bundleModule.exports;
    },
});
