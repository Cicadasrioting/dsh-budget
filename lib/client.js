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
            '.BGD_tabs{display:flex;gap:4px;flex-wrap:wrap;padding:3px;border-radius:10px;background:var(--dsw-alias-bg-l1);width:fit-content}',
            '.BGD_tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;padding:5px 12px;border-radius:8px;cursor:pointer;font-family:inherit}',
            '.BGD_tab:hover{color:var(--dsw-alias-label-primary)}',
            '.BGD_tab[data-active="1"]{background:var(--dsw-alias-bg-l3);color:var(--dsw-alias-label-primary);font-weight:600}',
            '.BGD_tasks{display:grid;grid-template-columns:repeat(auto-fill,minmax(268px,1fr));gap:12px;margin-top:14px}',
            '.BGD_task{position:relative;display:flex;flex-direction:column;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;padding:16px;background:var(--dsw-alias-bg-layer-3);transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}',
            '.BGD_task:hover{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 55%,var(--dsw-alias-border-l2));box-shadow:0 10px 24px rgba(0,0,0,.16);transform:translateY(-1px)}',
            '.BGD_taskHead{display:flex;align-items:center;gap:10px;min-width:0}',
            '.BGD_taskIcon{flex:none;width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary)}',
            '.BGD_taskIcon[data-tone=idle]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary)}',
            '.BGD_taskIcon[data-tone=ask]{background:color-mix(in srgb,var(--dsw-alias-state-warning-primary) 16%,transparent);color:var(--dsw-alias-state-warning-primary)}',
            '.BGD_taskIcon[data-tone=ok]{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);color:var(--dsw-alias-state-success-primary)}',
            '.BGD_taskIcon[data-tone=bad]{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}',
            '.BGD_taskHeadText{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}',
            '.BGD_taskTitle{font-size:14px;line-height:21px;font-weight:600;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.BGD_taskTitleInput{font-size:14px;font-weight:600;width:100%}',
            '.BGD_taskSub{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.BGD_taskBody{display:flex;flex-direction:column;gap:6px}',
            '.BGD_taskRow{display:flex;align-items:baseline;gap:10px;font-size:12px;line-height:18px;min-width:0}',
            '.BGD_taskLabel{flex:0 0 46px;color:var(--dsw-alias-label-tertiary)}',
            '.BGD_taskValue{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}',
            '.BGD_taskTags{display:flex;flex-wrap:wrap;gap:6px}',
            '.BGD_pill{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;border:1px solid var(--dsw-alias-line-2);color:var(--dsw-alias-label-secondary);white-space:nowrap}',
            '.BGD_pill[data-tone="run"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}',
            '.BGD_pill[data-tone="ask"]{color:var(--dsw-alias-text-warning);border-color:var(--dsw-alias-text-warning)}',
            '.BGD_pill[data-tone="ok"]{color:var(--dsw-alias-text-success);border-color:var(--dsw-alias-text-success)}',
            '.BGD_pill[data-tone="bad"]{color:var(--dsw-alias-text-danger);border-color:var(--dsw-alias-text-danger)}',
            '.BGD_taskPrompt{margin:0;font-size:12px;line-height:19px;color:var(--dsw-alias-label-tertiary);white-space:pre-wrap;max-height:56px;overflow:hidden}',
            '.BGD_taskPromptInput{width:100%;margin-top:8px;resize:vertical;font-size:13px;line-height:20px;font-family:inherit}',
            '.BGD_taskFoot{display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--dsw-alias-border-l2);padding-top:10px;margin-top:auto}',
            '.BGD_taskHint{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
            '.BGD_askBox{margin-top:2px;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1);border:1px solid color-mix(in srgb,var(--dsw-alias-state-warning-primary) 40%,transparent)}',
            '.BGD_askLabel{font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-text-warning);margin-bottom:4px}',
            '.BGD_askText{margin:0 0 8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);white-space:pre-wrap}',
            '.BGD_report{margin-top:2px;border-top:1px dashed var(--dsw-alias-line-1);padding-top:8px}',
            '.BGD_reportToggle{appearance:none;border:0;background:transparent;padding:0;font:inherit;font-size:12px;color:var(--dsw-alias-brand-primary);cursor:pointer}',
            '.BGD_reportBody{margin-top:8px;display:flex;flex-direction:column;gap:8px}',
            '.BGD_reportSummary{margin:0;font-size:13px;line-height:21px;color:var(--dsw-alias-label-primary);white-space:pre-wrap}',
            '.BGD_reportRounds{display:flex;flex-direction:column;gap:6px}',
            '.BGD_reportRound{display:flex;gap:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            '.BGD_reportRoundNo{flex:0 0 56px;color:var(--dsw-alias-label-secondary)}',
            '.BGD_reportRoundText{flex:1 1 auto;white-space:pre-wrap}',
            '.BGD_dialog::backdrop{background:transparent}',
            '.BGD_dialog{box-sizing:border-box;width:min(620px,92vw);max-width:min(620px,92vw);margin:auto;padding:0;border:0;background:transparent;color:inherit;outline:none}',
            '.BGD_modal{box-sizing:border-box;pointer-events:auto;width:min(620px,100%);max-height:84vh;overflow:auto;display:flex;flex-direction:column;border-radius:20px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);box-shadow:0 32px 72px rgba(0,0,0,.42)}',
            '.BGD_modalHead{display:flex;align-items:center;gap:10px;padding:18px 22px 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
            '.BGD_modalTitle{margin:0;font-size:15px;line-height:22px;font-weight:600;flex:1 1 auto}',
            '.BGD_modalClose{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:15px;line-height:1;cursor:pointer;padding:5px;border-radius:8px}',
            '.BGD_modalClose:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
            '.BGD_modalBody{display:flex;flex-direction:column;gap:10px;padding:18px 22px}',
            '.BGD_modalFoot{display:flex;align-items:center;gap:8px;justify-content:flex-end;padding:14px 22px 18px;border-top:1px solid var(--dsw-alias-border-l2)}',
            '.BGD_input.BGD_textarea{box-sizing:border-box;width:100%;height:auto;min-height:120px;padding:11px 13px;resize:vertical;line-height:21px;border-radius:10px}',
            '.BGD_select{box-sizing:border-box;width:100%;height:36px;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:0 10px;outline:none}',
            '.BGD_select:focus-visible{border-color:var(--dsw-alias-state-business-primary)}',
            '.BGD_pair{display:grid;grid-template-columns:1fr 110px;gap:10px}',
            '.BGD_switches{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:6px 0 4px}',
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
            '.BGD_chart{display:flex;flex-direction:column;gap:6px;margin-top:2px}',
            '.BGD_chartHead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
            '.BGD_chartTitle{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.BGD_chartHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
            '.BGD_chartBody{display:flex;align-items:flex-end;gap:2px;height:96px;padding-top:6px;border-bottom:1px solid var(--dsw-alias-border-l2)}',
            '.BGD_chartCol{flex:1 1 0;min-width:0;height:100%;display:flex;align-items:flex-end}',
            '.BGD_chartBar{width:100%;border-radius:3px 3px 0 0;background:var(--dsw-alias-state-business-primary);opacity:.85;transition:height .3s ease,opacity .15s ease}',
            '.BGD_chartCol:hover .BGD_chartBar{opacity:1}',
            '.BGD_chartCol[data-today="1"] .BGD_chartBar{background:var(--dsw-alias-state-warning-primary);opacity:1}',
            '.BGD_chartAxis{display:flex;gap:2px}',
            '.BGD_chartTick{flex:1 1 0;min-width:0;text-align:center;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
            '.BGD_chartTick[data-empty="1"]{color:transparent}',
            '.BGD_queue{display:flex;flex-direction:column;gap:2px}',
            '.BGD_queueRow{display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}',
            '.BGD_queueRow:last-child{border-bottom:0}',
            '.BGD_queueMain{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}',
            '.BGD_queueTitle{font-size:13px;line-height:20px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.BGD_queueHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
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
            const text = CSS + '.BGD_icon{--BGD_glyph:' + GLYPH + '}';
            // 不能「有 style 标签就 return」：宿主会热替换客户端束，旧标签还挂在 head 上，
            // 新加的规则就会一直不生效（加柱状图时踩过）。改成内容对不上就覆盖。
            const existing = document.getElementById('dsh-budget-style');
            if (existing !== null) {
                if (existing.textContent !== text) existing.textContent = text;
                return;
            }
            const style = document.createElement('style');
            style.id = 'dsh-budget-style';
            style.textContent = text;
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

        /**
         * 当月每天的消费柱状图（对齐平台「用量信息」那张图）。
         * 只画到「今天」为止；没有账单数据的日子按 0 处理，柱子留空。
         */
        function BillingChart({ days, monthKey, currency }) {
            const source = days && typeof days === 'object' ? days : {};
            const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey ?? ''));
            if (match === null) return null;
            const year = Number(match[1]);
            const month = Number(match[2]);
            const now = new Date();
            const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month;
            const daysInMonth = new Date(year, month, 0).getDate();
            const last = isCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
            const cells = [];
            let max = 0;
            let sum = 0;
            for (let day = 1; day <= last; day += 1) {
                const key = match[0] + '-' + String(day).padStart(2, '0');
                const cost = typeof source[key] === 'number' ? source[key] : 0;
                sum += cost;
                if (cost > max) max = cost;
                cells.push({ day, cost });
            }
            if (cells.length === 0) return null;
            const top = max > 0 ? max : 1;
            // 柱高直接用 px 算，不依赖百分比高度（flex 里的 % 高度一遇到容器高度不确定就塌成 0）
            const CHART_HEIGHT = 88;
            return h('div', { className: 'BGD_chart' }, [
                h('div', { className: 'BGD_chartHead', key: 'h' }, [
                    h('span', { className: 'BGD_chartTitle', key: 't' }, '当月每天消费'),
                    h('span', { className: 'BGD_chartHint', key: 's' }, money(sum, currency) + ' · ' + cells.length + ' 天'),
                ]),
                h('div', { className: 'BGD_chartBody', key: 'b' }, cells.map(({ day, cost }) => {
                    const height = cost > 0 ? Math.max(3, Math.round((cost / top) * CHART_HEIGHT)) : 0;
                    return h('div', {
                        className: 'BGD_chartCol',
                        key: day,
                        title: match[0] + '-' + String(day).padStart(2, '0') + ' · ' + money(cost, currency),
                        'data-today': isCurrentMonth && day === now.getDate() ? '1' : undefined,
                    }, h('div', {
                        className: 'BGD_chartBar',
                        style: height > 0 ? { height: height + 'px' } : { display: 'none' },
                    }));
                })),
                h('div', { className: 'BGD_chartAxis', key: 'a' }, cells.map(({ day }) => {
                    const show = day === 1 || day % 5 === 0 || day === last;
                    return h('span', {
                        className: 'BGD_chartTick',
                        key: day,
                        'data-empty': show ? undefined : '1',
                    }, show ? String(day) : '·');
                })),
            ]);
        }

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
        function fmtDelay(ms) {
            if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
            const minutes = Math.round(ms / 60000);
            if (minutes < 60) return minutes + ' 分钟';
            const hours = Math.floor(minutes / 60);
            const rest = minutes % 60;
            return rest === 0 ? hours + ' 小时' : hours + ' 小时 ' + rest + ' 分';
        }

        const TASK_STATUS = {
            queued: '排队中',
            running: '跑着呢',
            waiting: '等你回话',
            done: '跑完了',
            failed: '挂了',
        };

        /** 状态色：靠 data-tone 挂在卡片上当左侧色条。 */
        const TASK_TONE = { queued: 'idle', running: 'run', waiting: 'ask', done: 'ok', failed: 'bad' };

        /** 页签。 */
        const TABS = [
            { id: 'overview', label: '概览' },
            { id: 'stingy', label: '抠搜模式' },
            { id: 'settings', label: '设置' },
        ];

        /** 用时文案：几秒 / 几分 / 几小时。 */
        function fmtSpent(ms) {
            if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return '';
            if (ms < 60_000) return Math.max(1, Math.round(ms / 1000)) + ' 秒';
            return fmtDelay(ms);
        }

        /**
         * 一条任务 = 一张卡。
         * 卡片自己管「编辑中 / 回话框 / 报告展开」这些局部状态，面板只管发请求。
         */
        /** 一条队列任务的卡片：图标、标题、状态标签、两行元信息、动作。 */
        function TaskCard({ item, busy, onSave, onResume, onAnswer, onDrop, onRun }) {
            const [editing, setEditing] = react.useState(false);
            const [title, setTitle] = react.useState(item.title);
            const [prompt, setPrompt] = react.useState(item.prompt);
            const [rounds, setRounds] = react.useState(String(item.maxRounds ?? 3));
            const [answer, setAnswer] = react.useState('');
            const [showReport, setShowReport] = react.useState(false);

            const status = item.status ?? 'queued';
            const tone = TASK_TONE[status] ?? 'idle';
            const maxRounds = item.maxRounds ?? 3;
            const shortSession = item.sessionId ? String(item.sessionId).replace(/^session-/, '').slice(0, 8) : '';
            const spent = item.startedAt ? fmtSpent((item.finishedAt ?? Date.now()) - item.startedAt) : '';
            const firstLine = String(item.prompt ?? '').split('\n')[0];

            const save = () => {
                void onSave(item.id, { title, prompt, maxRounds: Number(rounds) || undefined });
                setEditing(false);
            };
            const row = (key, label, value) =>
                h('div', { className: 'BGD_taskRow', key },
                    h('span', { className: 'BGD_taskLabel' }, label),
                    h('span', { className: 'BGD_taskValue', title: value }, value));

            const header = editing
                ? h('div', { className: 'BGD_field', key: 'h' }, [
                      h('input', {
                          key: 't',
                          className: 'BGD_input BGD_taskTitleInput',
                          value: title,
                          onChange: (event) => setTitle(event.target.value),
                      }),
                      h('div', { className: 'BGD_row', key: 'r' }, [
                          h('input', {
                              key: 'n',
                              className: 'BGD_input',
                              style: { width: '74px', flex: '0 0 74px' },
                              value: rounds,
                              title: '最多自动跑几轮',
                              onChange: (event) => setRounds(event.target.value.replace(/[^0-9]/g, '')),
                          }),
                          h('button', { key: 's', type: 'button', className: 'BGD_btn', 'data-primary': true, disabled: busy, onClick: save }, '保存'),
                          h('button', { key: 'c', type: 'button', className: 'BGD_btn', disabled: busy, onClick: () => setEditing(false) }, '取消'),
                      ]),
                  ])
                : h('div', { className: 'BGD_taskHead', key: 'h' }, [
                      h('span', { className: 'BGD_taskIcon', 'data-tone': tone, key: 'i' }, h(PanelIcon, { size: 17 })),
                      h('div', { className: 'BGD_taskHeadText', key: 'x' }, [
                          h('span', { className: 'BGD_taskTitle', key: 't', title: item.title }, item.title),
                          h('span', { className: 'BGD_taskSub', key: 's', title: firstLine }, firstLine),
                      ]),
                      h('span', { className: 'BGD_pill', key: 'p', 'data-tone': tone }, TASK_STATUS[status] ?? status),
                  ]);

            const tags = (Array.isArray(item.roundsLog) ? item.roundsLog.length : 0) > 0 || item.report
                ? [h('span', { className: 'BGD_pill', key: 'r' }, '第 ' + (item.rounds ?? 1) + ' / ' + maxRounds + ' 轮'),
                   item.report ? h('span', { className: 'BGD_pill', 'data-tone': 'ok', key: 'rep' }, '有报告') : null]
                : null;

            return h('div', { className: 'BGD_task', 'data-tone': tone, key: item.id }, [
                header,
                h('div', { className: 'BGD_taskBody', key: 'body' }, [
                    row('c', '会话', shortSession === '' ? '新开一个' : '…' + shortSession),
                    spent === '' ? null : row('t', status === 'running' ? '已跑' : '用时', spent),
                ].filter((part) => part !== null)),
                tags === null ? null : h('div', { className: 'BGD_taskTags', key: 'tags' }, tags.filter((part) => part !== null)),
                editing
                    ? h('textarea', {
                          key: 'p',
                          className: 'BGD_input BGD_taskPromptInput',
                          value: prompt,
                          rows: 5,
                          onChange: (event) => setPrompt(event.target.value),
                      })
                    : h('p', { className: 'BGD_taskPrompt', key: 'p', title: item.prompt }, item.prompt),
                status === 'waiting'
                    ? h('div', { className: 'BGD_askBox', key: 'ask' }, [
                          h('div', { className: 'BGD_askLabel', key: 'l' }, '它在等你这句'),
                          h('p', { className: 'BGD_askText', key: 't' }, item.question ?? item.awaiting ?? ''),
                          h('textarea', {
                              key: 'i',
                              className: 'BGD_input BGD_taskPromptInput',
                              rows: 3,
                              value: answer,
                              placeholder: '回一句它就接着干；直接点「你自己定」也行',
                              onChange: (event) => setAnswer(event.target.value),
                          }),
                          h('div', { className: 'BGD_row', key: 'r' }, [
                              h('button', {
                                  key: 'a',
                                  type: 'button',
                                  className: 'BGD_btn',
                                  'data-primary': true,
                                  disabled: busy || answer.trim() === '',
                                  onClick: () => {
                                      void onAnswer(item.id, answer.trim());
                                      setAnswer('');
                                  },
                              }, '回话并继续'),
                              h('button', {
                                  key: 'c',
                                  type: 'button',
                                  className: 'BGD_btn',
                                  disabled: busy,
                                  title: '让它按自己的判断做掉',
                                  onClick: () => void onResume(item.id),
                              }, '你自己定'),
                          ]),
                      ])
                    : null,
                item.report
                    ? h('div', { className: 'BGD_report', key: 'rep' }, [
                          h('button', {
                              key: 'b',
                              type: 'button',
                              className: 'BGD_reportToggle',
                              onClick: () => setShowReport(!showReport),
                          }, (showReport ? '收起报告' : '看报告') + ' · ' + (item.report.rounds ?? 0) + ' 轮 / ' + fmtSpent(item.report.durationMs)),
                          showReport
                              ? h('div', { className: 'BGD_reportBody', key: 'body' }, [
                                    h('p', { className: 'BGD_reportSummary', key: 's' }, item.report.summary ?? '（没留结论）'),
                                    (Array.isArray(item.roundsLog) ? item.roundsLog : []).length === 0
                                        ? null
                                        : h('div', { className: 'BGD_reportRounds', key: 'r' }, item.roundsLog.map((entry) =>
                                              h('div', { className: 'BGD_reportRound', key: String(entry.round) + entry.at },
                                                  h('span', { className: 'BGD_reportRoundNo' }, '第 ' + entry.round + ' 轮'),
                                                  h('span', { className: 'BGD_reportRoundText' }, entry.text || '（没有正文）')),
                                          )),
                                ])
                              : null,
                      ])
                    : null,
                editing
                    ? null
                    : h('div', { className: 'BGD_taskFoot', key: 'f' }, [
                          status === 'running'
                              ? h('span', { className: 'BGD_taskHint', key: 'h' }, '跑着呢，等它收尾')
                              : h('button', {
                                    key: 'e',
                                    type: 'button',
                                    className: 'BGD_btn',
                                    disabled: busy,
                                    onClick: () => {
                                        setTitle(item.title);
                                        setPrompt(item.prompt);
                                        setRounds(String(maxRounds));
                                        setEditing(true);
                                    },
                                }, '编辑'),
                          status === 'queued'
                              ? h('button', {
                                    key: 'run',
                                    type: 'button',
                                    className: 'BGD_btn',
                                    disabled: busy,
                                    title: '不看峰谷，现在就派这条',
                                    onClick: () => void onRun(item.id),
                                }, '立刻执行')
                              : null,
                          status === 'waiting' || status === 'failed'
                              ? h('button', {
                                    key: 'rr',
                                    type: 'button',
                                    className: 'BGD_btn',
                                    disabled: busy,
                                    onClick: () => void onResume(item.id),
                                }, status === 'failed' ? '重试' : '继续')
                              : null,
                          h('span', { style: { flex: '1 1 auto' }, key: 'sp' }),
                          h('button', {
                              key: 'd',
                              type: 'button',
                              className: 'BGD_btn',
                              'data-danger': true,
                              disabled: busy,
                              onClick: () => void onDrop(item.id),
                          }, '删'),
                      ]),
            ]);
        }

        /** 新建任务弹窗：任务内容 + 接到哪个会话 + 最多几轮。 */
        function TaskDialog({ open, busy, sessions, onClose, onCreate }) {
            const [text, setText] = react.useState('');
            const [title, setTitle] = react.useState('');
            const [rounds, setRounds] = react.useState('');
            const [sessionId, setSessionId] = react.useState('');

            // 原生 <dialog> 的 top layer：相对视口居中，不会被面板的 transform 带偏
            const dialogRef = react.useRef(null);
            react.useEffect(() => {
                const node = dialogRef.current;
                if (!open || node === null) return undefined;
                try {
                    if (typeof node.showModal === 'function' && node.open !== true) node.showModal();
                } catch {
                    /* 老宿主没有 showModal，退化成普通块 */
                }
                return () => {
                    try {
                        if (typeof node.close === 'function' && node.open === true) node.close();
                    } catch {
                        /* 已经被卸载了 */
                    }
                };
            }, [open]);

            if (!open) return null;
            const list = Array.isArray(sessions) ? sessions : [];
            const submit = () => {
                if (text.trim() === '') return;
                void onCreate(text.trim(), {
                    title: title.trim(),
                    maxRounds: rounds === '' ? undefined : Number(rounds),
                    sessionId,
                });
                setText('');
                setTitle('');
                setRounds('');
                setSessionId('');
            };
            return h('dialog', { className: 'BGD_dialog', ref: dialogRef, onCancel: (event) => { event.preventDefault(); if (!busy) onClose(); } }, h('div', { className: 'BGD_modal' }, [
                h('div', { className: 'BGD_modalHead', key: 'h' }, [
                    h('h3', { className: 'BGD_modalTitle', key: 't' }, '新建任务'),
                    h('button', { key: 'x', type: 'button', className: 'BGD_modalClose', onClick: () => (busy ? null : onClose()) }, '✕'),
                ]),
                h('div', { className: 'BGD_modalBody', key: 'b' }, [
                    h('label', { className: 'BGD_fieldLabel', key: 'l1' }, '要它干什么'),
                    h('textarea', {
                        key: 'i',
                        className: 'BGD_input BGD_textarea',
                        rows: 6,
                        value: text,
                        autoFocus: true,
                        placeholder: '例如：把 dsh-budget 的 README 补上「抠搜模式」一节，顺手跑一遍冒烟测试',
                        onChange: (event) => setText(event.target.value),
                    }),
                    h('label', { className: 'BGD_fieldLabel', key: 'l2' }, '接到哪个会话'),
                    h('select', {
                        key: 's',
                        className: 'BGD_select',
                        value: sessionId,
                        title: '选已有会话：它带着那段上下文接着干，不用从零开始',
                        onChange: (event) => setSessionId(event.target.value),
                    }, [h('option', { value: '', key: 'none' }, '新开会话（从头开始）')].concat(
                        list.map((row) => h('option', { value: row.id, key: row.id }, (row.title === '' ? row.id : row.title).slice(0, 48))),
                    )),
                    h('div', { className: 'BGD_pair', key: 'p' }, [
                        h('div', { className: 'BGD_field', key: 't' }, [
                            h('label', { className: 'BGD_fieldLabel', key: 'l' }, '标题（可留空）'),
                            h('input', {
                                key: 'i',
                                className: 'BGD_input',
                                style: { width: '100%' },
                                value: title,
                                placeholder: '留空就取任务第一行',
                                onChange: (event) => setTitle(event.target.value),
                            }),
                        ]),
                        h('div', { className: 'BGD_field', key: 'n' }, [
                            h('label', { className: 'BGD_fieldLabel', key: 'l' }, '最多几轮'),
                            h('input', {
                                key: 'i',
                                className: 'BGD_input',
                                style: { width: '100%' },
                                value: rounds,
                                placeholder: '默认 3',
                                onChange: (event) => setRounds(event.target.value.replace(/[^0-9]/g, '')),
                            }),
                        ]),
                    ]),
                ]),
                h('div', { className: 'BGD_modalFoot', key: 'f' }, [
                    h('span', { className: 'BGD_taskHint', key: 'hint' }, '峰价时先排着，转平价自动开跑。'),
                    h('button', { key: 'c', type: 'button', className: 'BGD_btn', disabled: busy, onClick: () => (busy ? null : onClose()) }, '取消'),
                    h('button', {
                        key: 'o',
                        type: 'button',
                        className: 'BGD_btn',
                        'data-primary': true,
                        disabled: busy || text.trim() === '',
                        onClick: submit,
                    }, '创建任务'),
                ]),
            ]));
        }

        /** 抠搜模式卡片：峰谷相位 + 并发 + 自动审批 + 新建任务 + 任务卡。 */
        function SmartCard({ cheap, busy, onPatch, onDrop, onDispatch, onResume, onAnswer, onSave, sessions, onRunTask, onNewTask }) {
            const src = cheap ?? null;
            const [cwdDraft, setCwdDraft] = react.useState(null);
            if (src === null) {
                return h('div', { className: 'BGD_card' }, [
                    h('div', { className: 'BGD_cardHead', key: 'h' }, h('h2', { className: 'BGD_cardTitle' }, '抠搜模式')),
                    h('p', { className: 'BGD_status' }, '读不到峰谷状态'),
                ]);
            }
            const phase = src.phase ?? {};
            const peak = phase.peak === true;
            const enabled = phase.enabled === true;
            const kinds = src.kinds ?? [];
            const kindsOn = Array.isArray(src.autoApproveKinds) ? src.autoApproveKinds : [];
            const items = src.items ?? [];
            const queued = src.counts?.queued ?? 0;
            const running = src.counts?.running ?? 0;
            const limit = Number(src.concurrency ?? 1);
            const sessionOptions = Array.isArray(sessions) ? sessions : [];
            const phaseText = !enabled
                ? '峰谷计价没启用，全天一个价'
                : peak
                    ? '现在是峰价' + (phase.untilSwitch ? '，还有 ' + fmtDelay(phase.untilSwitch) + ' 转平价' : '')
                    : '现在是平价（谷价）' + (phase.untilSwitch ? '，还有 ' + fmtDelay(phase.untilSwitch) + ' 转峰价' : '');
            const toggleKind = (id) => {
                const next = kindsOn.includes(id) ? kindsOn.filter((k) => k !== id) : kindsOn.concat([id]);
                void onPatch({ autoApproveKinds: next }, '自动审批的类型已更新');
            };
            return h('div', { className: 'BGD_card' }, [
                h('div', { className: 'BGD_cardHead', key: 'h' }, [
                    h('h2', { className: 'BGD_cardTitle', key: 't' }, '抠搜模式'),
                    h('span', { className: 'BGD_badge', key: 'b', 'data-kind': peak ? 'warn' : 'ok' }, peak ? '峰价' : '平价'),
                ]),
                h('p', { className: 'BGD_status', key: 'phase' }, phaseText),
                h('div', { className: 'BGD_switches', key: 'sw' }, [
                    h(Switch, {
                        key: 'sw1',
                        on: src.stingy === true,
                        title: '峰价就攒着',
                        hint: '峰价期间排的任务不跑，等转平价自动放出去。',
                        disabled: busy,
                        onToggle: (nextValue) => void onPatch({ stingy: nextValue }, nextValue ? '抠搜模式已打开' : '抠搜模式已关闭'),
                    }),
                    h(Switch, {
                        key: 'sw2',
                        on: src.autoApprove === true,
                        title: '自动审批',
                        hint: '只对排队跑起来的那些会话生效，你自己聊天的审批照旧弹窗。',
                        disabled: busy,
                        onToggle: (nextValue) => void onPatch({ autoApprove: nextValue }, nextValue ? '自动审批已打开' : '自动审批已关闭'),
                    }),
                ]),
                src.autoApprove === true
                    ? h('div', { className: 'BGD_row', key: 'kinds' }, kinds.map((kind) =>
                          h('button', {
                              key: kind.id,
                              type: 'button',
                              className: 'BGD_btn',
                              'data-primary': kindsOn.includes(kind.id),
                              title: kind.hint,
                              disabled: busy,
                              onClick: () => toggleKind(kind.id),
                          }, kind.label),
                      ))
                    : null,
                h('div', { className: 'BGD_field', key: 'conc' }, [
                    h('label', { className: 'BGD_fieldLabel', key: 'l' }, '同时跑几条'),
                    h('div', { className: 'BGD_row', key: 'r' }, [1, 2, 3, 4, 6, 8].map((n) =>
                        h('button', {
                            key: String(n),
                            type: 'button',
                            className: 'BGD_btn',
                            'data-primary': n === limit,
                            disabled: busy,
                            onClick: () => void onPatch({ concurrency: n }, '并发上限改成 ' + n),
                        }, String(n)),
                    )),
                    h('p', { className: 'BGD_status', key: 'h' }, '现在 ' + running + ' 条在跑，上限 ' + limit + ' 条；每条任务单独一个会话。'),
                ]),
                h('div', { className: 'BGD_field', key: 'cwd' }, [
                    h('label', { className: 'BGD_fieldLabel', key: 'l' }, '任务在哪个目录跑'),
                    h('div', { className: 'BGD_row', key: 'r' }, [
                        h('input', {
                            key: 'i',
                            className: 'BGD_input',
                            style: { width: '100%', flex: '1 1 240px' },
                            value: cwdDraft === null ? (src.queueCwd || '') : cwdDraft,
                            placeholder: '留空用默认工作区，比如 C:\\work',
                            onChange: (event) => setCwdDraft(event.target.value),
                            onBlur: () => {
                                if (cwdDraft === null || cwdDraft === (src.queueCwd || '')) return;
                                void onPatch({ queueCwd: cwdDraft }, '任务目录已更新');
                                setCwdDraft(null);
                            },
                        }),
                    ]),
                ]),
                h('div', { className: 'BGD_row', key: 'add' }, [
                    h('button', {
                        key: 'n',
                        type: 'button',
                        className: 'BGD_btn',
                        'data-primary': true,
                        disabled: busy,
                        onClick: () => onNewTask(),
                    }, '+ 新建任务'),
                    h('button', {
                        key: 'run',
                        type: 'button',
                        className: 'BGD_btn',
                        disabled: busy || queued === 0,
                        title: '不看峰谷，把排着的都放出去',
                        onClick: () => void onDispatch(),
                    }, '全部开跑'),
                    h('span', { className: 'BGD_taskHint', key: 'hint' }, queued === 0 ? '队列是空的，点「+ 新建任务」排一条。' : '排着 ' + queued + ' 条。'),
                ]),
                items.length === 0
                    ? h('p', { className: 'BGD_status', key: 'empty' }, '队列是空的。')
                    : h('div', { className: 'BGD_tasks', key: 'list' },
                          items.slice().reverse().map((item) =>
                              h(TaskCard, {
                                  key: item.id,
                                  item,
                                  busy,
                                  onSave,
                                  onResume,
                                  onAnswer,
                                  onDrop,
                                  onRun: onRunTask,
                              }),
                          )),
                src.lastApproval === null || src.lastApproval === undefined
                    ? null
                    : h('p', { className: 'BGD_status', key: 'last' },
                        '上次自动放行：' + src.lastApproval.toolName + '（' + src.lastApproval.kind + '）'),
            ]);
        }

        function BudgetPanel(props) {
            const backToConversation = props?.backToConversation;
            const [data, setData] = react.useState(null);
            const [error, setError] = react.useState(null);
            const [busy, setBusy] = react.useState(false);
            const [draft, setDraft] = react.useState('');
            const [tab, setTab] = react.useState('overview');
            const [sessions, setSessions] = react.useState([]);
            const [taskDialog, setTaskDialog] = react.useState('closed');
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
                const loadSessions = async () => {
                    try {
                        const result = await request('/sessions', { method: 'GET' });
                        setSessions(Array.isArray(result?.sessions) ? result.sessions : []);
                    } catch {
                        setSessions([]);
                    }
                };
                void loadSessions();
                const timer = setInterval(() => void loadSessions(), 60_000);
                return () => clearInterval(timer);
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
            const cheap = data?.cheap ?? null;
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

            // 抠搜模式的队列操作
            const addTask = async (text, opts = {}) => {
                if (text === '') return;
                setBusy(true);
                setNotice(null);
                try {
                    await request('/queue', {
                        method: 'POST',
                        body: JSON.stringify({
                            text,
                            title: opts.title,
                            maxRounds: opts.maxRounds,
                            sessionId: opts.sessionId,
                        }),
                    });
                    setNotice('排上了，谷价一到就开跑');
                    await load();
                } catch (e) {
                    setNotice('排队失败：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            // 改一条还没跑完的任务
            const saveTask = async (id, patchBody) => {
                setBusy(true);
                setNotice(null);
                try {
                    await request('/queue', { method: 'POST', body: JSON.stringify({ id, action: 'update', patch: patchBody }) });
                    setNotice('改好了');
                    await load();
                } catch (e) {
                    setNotice('改不动：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            // 面板里回它一句，然后接着跑
            const answerTask = async (id, text) => {
                setBusy(true);
                setNotice(null);
                try {
                    await request('/queue', { method: 'POST', body: JSON.stringify({ id, action: 'answer', text }) });
                    setNotice('回过去了，接着干');
                    await load();
                } catch (e) {
                    setNotice('回不过去：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            // 立刻派这一条（不看峰谷）
            const runTask = async (id) => {
                setBusy(true);
                setNotice(null);
                try {
                    await request('/dispatch?force=1&id=' + encodeURIComponent(id), { method: 'POST', body: '{}' });
                    setNotice('这就开跑');
                    await load();
                } catch (e) {
                    setNotice('派不出去：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            const dropTask = async (id) => {
                setBusy(true);
                setNotice(null);
                try {
                    await request('/queue?id=' + encodeURIComponent(id), { method: 'DELETE' });
                    setNotice('已删掉');
                    await load();
                } catch (e) {
                    setNotice('删不掉：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            // 人工点「继续」：让那条任务接着跑一轮
            const resumeTask = async (id) => {
                setBusy(true);
                setNotice(null);
                try {
                    await request('/queue', { method: 'POST', body: JSON.stringify({ id, action: 'resume' }) });
                    setNotice('接着跑了');
                    await load();
                } catch (e) {
                    setNotice('续不上：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            const dispatch = async () => {
                setBusy(true);
                setNotice(null);
                try {
                    await request('/dispatch?force=1', { method: 'POST', body: '{}' });
                    setNotice('开工了');
                    await load();
                } catch (e) {
                    setNotice('派不出去：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    setBusy(false);
                }
            };

            const headline = plan === null ? '读不到计费状态' : money(Math.max(0, plan.remaining), plan.currency);            const badge = badgeOf(gate);
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
                h('div', { className: 'BGD_tabs', key: 'tabs' }, TABS.map((item) =>
                    h('button', {
                        key: item.id,
                        type: 'button',
                        className: 'BGD_tab',
                        'data-active': tab === item.id ? '1' : '0',
                        onClick: () => setTab(item.id),
                    }, item.label))),

                // 今天
                tab === 'overview' ? h('div', { className: 'BGD_card', key: 'today' }, [
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
                ]) : null,

                // 本月
                tab === 'overview' ? h('div', { className: 'BGD_card', key: 'month' }, [
                    h('div', { className: 'BGD_cardHead', key: 'h' }, h('h2', { className: 'BGD_cardTitle' }, '本月')),
                    h('div', { className: 'BGD_grid', key: 'g' }, [
                        h(Kv, { key: 'q', label: '月额度', value: plan === null ? '—' : money(plan.monthlyQuota, plan.currency) }),
                        h(Kv, { key: 'w', label: '工作日', value: plan === null ? '—' : plan.totalWorkdays + ' 天（已过 ' + plan.elapsedWorkdays + '）' }),
                        h(Kv, { key: 'a', label: '日均', value: plan === null ? '—' : money(plan.dailyAverage, plan.currency) }),
                        h(Kv, { key: 'r', label: '月剩余', value: plan === null ? '—' : money(plan.monthRemaining, plan.currency) }),
                    ]),
                ]) : null,

                // 账单同步（平台用量接口 = 真账单）
                tab === 'overview' ? h('div', { className: 'BGD_card', key: 'bill' }, [
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
                    h(BillingChart, { key: 'chart', days: bill.days, monthKey: bill.monthKey, currency: bill.currency }),
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
                ]) : null,

                // 抠搜模式：峰价攒活，谷价再跑
                tab === 'stingy' ? h(SmartCard, {
                    key: 'cheap',
                    cheap,
                    busy,
                    onNewTask: () => setTaskDialog('open'),
                    onPatch: patch,
                    onDrop: dropTask,
                    onResume: resumeTask,
                    onAnswer: answerTask,
                    onSave: saveTask,
                    onDispatch: dispatch,
                    onRunTask: runTask,
                    sessions,
                }) : null,

                // 新建任务弹窗
                taskDialog === 'open'
                    ? h(TaskDialog, {
                          key: 'dialog',
                          open: true,
                          busy,
                          sessions,
                          onClose: () => setTaskDialog('closed'),
                          onCreate: async (text, opts) => {
                              await addTask(text, opts);
                              setTaskDialog('closed');
                          },
                      })
                    : null,

                // 配置
                tab === 'settings' ? h('div', { className: 'BGD_card', key: 'config' }, [
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
                ]) : null,
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
