window.__ModuleLoader__.load({
  id: 'dsh-plugin-offline-sync',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    exports.inject = ['slots'];

    var STYLE_ID = 'dsh-plugin-offline-sync-styles-v2';

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return;
      var styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = [
        '.dsh-sync-root{padding:24px;max-width:1080px;font-family:var(--dsw-font-family-base,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);color:var(--dsw-alias-label-primary,#17212b)}',
        '.dsh-sync-header{margin-bottom:22px;display:flex;align-items:flex-start;gap:14px}',
        '.dsh-sync-header-icon{width:42px;height:42px;border-radius:12px;background:linear-gradient(135deg,var(--dsw-alias-brand-primary,#2563eb),#7c3aed);display:flex;align-items:center;justify-content:center;color:#fff;flex-shrink:0;box-shadow:0 6px 16px rgba(37,99,235,.32);font-size:20px}',
        '.dsh-sync-title{font-size:20px;font-weight:700;margin:0 0 4px;color:var(--dsw-alias-label-primary,#17212b)}',
        '.dsh-sync-subtitle{font-size:13px;color:var(--dsw-alias-label-tertiary,#64748b);line-height:1.5}',
        '.dsh-sync-card{background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:16px;padding:20px;margin-bottom:18px;box-shadow:0 1px 3px rgba(0,0,0,.04)}',
        '.dsh-sync-card-title{font-size:15px;font-weight:700;margin:0 0 16px;color:var(--dsw-alias-label-primary,#17212b);display:flex;align-items:center;gap:10px}',
        '.dsh-sync-card-title::before{content:"";width:4px;height:18px;border-radius:3px;background:var(--dsw-alias-brand-primary,#2563eb)}',
        '.dsh-sync-row{display:flex;gap:10px;align-items:center}',
        '.dsh-sync-input{flex:1;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;background:var(--dsw-alias-bg-input,#fff);color:var(--dsw-alias-label-primary,#17212b);font-size:13px;outline:none;transition:border-color .15s,box-shadow .15s}',
        '.dsh-sync-input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb);box-shadow:0 0 0 3px rgba(37,99,235,.12)}',
        '.dsh-sync-btn{padding:8px 16px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);background:var(--dsw-alias-bg-module-platform,#fff);color:var(--dsw-alias-label-primary,#17212b);border-radius:10px;font-size:13px;cursor:pointer;transition:all .15s;white-space:nowrap;font-weight:500}',
        '.dsh-sync-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9);border-color:#cbd5e1;transform:translateY(-1px)}',
        '.dsh-sync-btn.primary{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);color:#fff;font-weight:600;box-shadow:0 2px 8px rgba(37,99,235,.3)}',
        '.dsh-sync-btn.primary:hover{background:var(--dsw-alias-brand-primary-hover,#1d4ed8);border-color:var(--dsw-alias-brand-primary-hover,#1d4ed8);box-shadow:0 4px 12px rgba(37,99,235,.4)}',
        '.dsh-sync-btn:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}',
        '.dsh-sync-toolbar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center;justify-content:space-between}',        '.dsh-sync-toolbar-left{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',        '.dsh-sync-toolbar-right{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',        '.dsh-sync-modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;z-index:2147483647;backdrop-filter:blur(2px)}',        '.dsh-sync-modal{background:var(--dsw-alias-bg-module-platform,#fff);border-radius:16px;padding:24px;width:min(480px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.25);border:1px solid var(--dsw-alias-border-l2,#e2e8f0)}',        '.dsh-sync-modal-title{font-size:16px;font-weight:700;margin:0 0 6px;color:var(--dsw-alias-label-primary,#17212b)}',        '.dsh-sync-modal-desc{font-size:13px;color:var(--dsw-alias-label-tertiary,#64748b);margin:0 0 16px;line-height:1.5}',        '.dsh-sync-modal-input{width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;background:var(--dsw-alias-bg-input,#fff);color:var(--dsw-alias-label-primary,#17212b);font-size:13px;outline:none;box-sizing:border-box;transition:border-color .15s,box-shadow .15s}',        '.dsh-sync-modal-input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb);box-shadow:0 0 0 3px rgba(37,99,235,.12)}',        '.dsh-sync-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}',
        '.dsh-sync-alert{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:16px;line-height:1.5}',
        '.dsh-sync-alert.error{background:rgba(239,68,68,.08);color:var(--dsw-alias-color-error,#b91c1c);border:1px solid rgba(239,68,68,.2)}',
        '.dsh-sync-alert.success{background:rgba(34,197,94,.08);color:var(--dsw-alias-color-success,#166534);border:1px solid rgba(34,197,94,.2);white-space:pre-wrap}',
        '.dsh-sync-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}',
        '.dsh-sync-item{position:relative;display:flex;flex-direction:column;gap:8px;padding:18px;padding-left:46px;border:2px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:14px;background:var(--dsw-alias-bg-module-platform,#fff);cursor:pointer;transition:all .18s;overflow:hidden}',
        '.dsh-sync-item:hover{border-color:#cbd5e1;transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,.08)}',
        '.dsh-sync-item.selected{border-color:var(--dsw-alias-brand-primary,#2563eb);background:linear-gradient(135deg,rgba(37,99,235,.06),rgba(124,58,237,.04));box-shadow:0 6px 16px rgba(37,99,235,.15)}',
        '.dsh-sync-item input[type=checkbox]{position:absolute;top:18px;left:16px;width:18px;height:18px;accent-color:var(--dsw-alias-brand-primary,#2563eb);cursor:pointer;z-index:1}',
        '.dsh-sync-exclude-btn{position:absolute;top:14px;right:14px;background:transparent;border:none;color:var(--dsw-alias-label-tertiary,#94a3b8);cursor:pointer;font-size:14px;padding:4px;border-radius:6px;line-height:1;opacity:0;transition:opacity .15s,color .15s,background .15s}',
        '.dsh-sync-item:hover .dsh-sync-exclude-btn{opacity:1}',
        '.dsh-sync-exclude-btn:hover{color:var(--dsw-alias-color-error,#dc2626);background:rgba(239,68,68,.1)}',
        '.dsh-sync-excluded-section{margin-top:18px;padding-top:16px;border-top:1px dashed var(--dsw-alias-border-l2,#e2e8f0)}',
        '.dsh-sync-excluded-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-tertiary,#64748b);margin:0 0 10px;display:flex;align-items:center;justify-content:space-between}',
        '.dsh-sync-excluded-list{display:flex;flex-wrap:wrap;gap:8px}',
        '.dsh-sync-excluded-tag{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:999px;background:var(--dsw-alias-bg-module-sub,#f9fafb);font-size:12px;color:var(--dsw-alias-label-secondary,#475569)}',
        '.dsh-sync-excluded-tag button{background:none;border:none;color:var(--dsw-alias-brand-primary,#2563eb);cursor:pointer;font-size:12px;padding:0;font-weight:600}',
        '.dsh-sync-excluded-tag button:hover{text-decoration:underline}',
        '.dsh-sync-clearing{opacity:.6;pointer-events:none}',
        '.dsh-sync-item-main{min-width:0}',
        '.dsh-sync-item-name{font-weight:700;font-size:15px;color:var(--dsw-alias-label-primary,#17212b);display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:2px}',
        '.dsh-sync-badge{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-tag,#e5e7eb);color:var(--dsw-alias-label-tertiary,#64748b);font-weight:600}',
        '.dsh-sync-badge.changed{background:rgba(245,158,11,.16);color:var(--dsw-alias-color-warning,#92400e)}',
        '.dsh-sync-badge.version{background:rgba(37,99,235,.1);color:var(--dsw-alias-brand-primary,#2563eb)}',
        '.dsh-sync-item-desc{color:var(--dsw-alias-label-tertiary,#64748b);font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
        '.dsh-sync-empty{padding:48px 24px;text-align:center;color:var(--dsw-alias-label-tertiary,#64748b);font-size:13px;grid-column:1/-1;border:1px dashed var(--dsw-alias-border-l2,#e2e8f0);border-radius:12px}',
        '.dsh-sync-footer{display:flex;justify-content:space-between;align-items:center;margin-top:20px;gap:12px;flex-wrap:wrap}',
        '.dsh-sync-count{font-size:13px;color:var(--dsw-alias-label-tertiary,#64748b)}',
        '.dsh-sync-count b{color:var(--dsw-alias-brand-primary,#2563eb);font-weight:700;font-size:15px}',
        '.dsh-sync-help{margin-top:18px;padding:16px 20px;background:var(--dsw-alias-bg-module-sub,#f9fafb);border-radius:14px;font-size:12px;color:var(--dsw-alias-label-secondary,#475569);border:1px solid var(--dsw-alias-border-l2,#e2e8f0)}',
        '.dsh-sync-help h4{margin:0 0 10px;font-size:13px;color:var(--dsw-alias-label-primary,#17212b)}',
        '.dsh-sync-help ol{margin:0;padding-left:20px;line-height:1.9}',
        '.dsh-sync-help code{background:var(--dsw-alias-bg-code,#e5e7eb);padding:1px 6px;border-radius:4px;font-size:11px}'
      ].join('\n');
      document.head.appendChild(styleEl);
    }

    function SyncPanel() {
      var _a = React.useState(null), data = _a[0], setData = _a[1];
      var _b = React.useState({}), selected = _b[0], setSelected = _b[1];
      var _c = React.useState(''), outputDir = _c[0], setOutputDir = _c[1];
      var _d = React.useState(false), loading = _d[0], setLoading = _d[1];
      var _e = React.useState(''), error = _e[0], setError = _e[1];
      var _f = React.useState(''), info = _f[0], setInfo = _f[1];
      var _g = React.useState(false), packing = _g[0], setPacking = _g[1];
      var _h = React.useState(false), clearing = _h[0], setClearing = _h[1];

      React.useEffect(function () { ensureStyles(); load(); }, []);

      function load() {
        setLoading(true); setError('');
        fetch('/dsh-plugin-offline-sync/plugins').then(function (r) { return r.json(); }).then(function (d) {
          setData(d);
          setOutputDir(d.outputDir);
          var sel = {};
          (d.plugins || []).forEach(function (p) { if (p.changed) sel[p.name] = true; });
          setSelected(sel);
          setLoading(false);
        }).catch(function (e) { setError(String(e)); setLoading(false); });
      }

      function toggle(name) {
        setSelected(function (s) {
          var next = Object.assign({}, s);
          if (next[name]) delete next[name]; else next[name] = true;
          return next;
        });
      }

      function selectAll() {
        var sel = {};
        (data && data.plugins || []).forEach(function (p) { sel[p.name] = true; });
        setSelected(sel);
      }

      function selectChanged() {
        var sel = {};
        (data && data.plugins || []).forEach(function (p) { if (p.changed) sel[p.name] = true; });
        setSelected(sel);
      }

      function selectNone() { setSelected({}); }

      function pack() {
        var names = Object.keys(selected);
        if (names.length === 0) { setError('请先选择要打包的插件'); return; }
        setPacking(true); setError(''); setInfo('');
        fetch('/dsh-plugin-offline-sync/pack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ names: names, outputDir: outputDir || undefined }),
        }).then(function (r) { return r.json(); }).then(function (d) {
          setPacking(false);
          if (d.ok) {
            setInfo('打包完成: ' + d.zipName + '\n路径: ' + d.zipPath);
            load();
          } else {
            setError(d.error || '打包失败');
          }
        }).catch(function (e) { setError(String(e)); setPacking(false); });
      }

      function openOutput() {
        fetch('/dsh-plugin-offline-sync/open-output').catch(function () {});
      }

      function excludePlugin(name) {
        showConfirm('排除插件', '确定要排除插件「' + name + '」吗？\n排除后将不再出现在列表中，但可在下方恢复。', [
          {
            text: '排除', primary: true, danger: true, onClick: function () {
              fetch('/dsh-plugin-offline-sync/exclude', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, outputDir: outputDir || undefined }),
              }).then(parseResp).then(function (d) {
                if (d.ok) { setInfo('已排除: ' + name); load(); }
                else setError(d.error || '排除失败');
              }).catch(function (e) { setError(String(e)); });
            }
          }
        ]);
      }

      function restorePlugin(name) {
        fetch('/dsh-plugin-offline-sync/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name, outputDir: outputDir || undefined }),
        }).then(parseResp).then(function (d) {
          if (d.ok) { setInfo('已恢复: ' + name); load(); }
          else setError(d.error || '恢复失败');
        }).catch(function (e) { setError(String(e)); });
      }

      function restoreAll() {
        fetch('/dsh-plugin-offline-sync/restore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ all: true, outputDir: outputDir || undefined }),
        }).then(parseResp).then(function (d) {
          if (d.ok) { setInfo('已恢复全部排除的插件'); load(); }
          else setError(d.error || '恢复失败');
        }).catch(function (e) { setError(String(e)); });
      }

      function clearHistory() {
        function doClear(resetState) {
          setClearing(true); setError(''); setInfo('');
          fetch('/dsh-plugin-offline-sync/clear-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outputDir: outputDir || undefined, resetState: !!resetState }),
          }).then(parseResp).then(function (d) {
            setClearing(false);
            if (d.ok) {
              var msg = '已清除历史：删除 ' + (d.deleted || 0) + ' 个 ZIP 文件';
              if (resetState && d.stateCleared) msg += '，已重置"有更新"检测状态';
              setInfo(msg);
              load();
            } else {
              setError(d.error || '清除失败');
            }
          }).catch(function (e) { setError(String(e)); setClearing(false); });
        }
        showConfirm('清除历史', '请选择清除方式：\n\n• 仅清除压缩包：删除所有已生成的 ZIP 文件，保留"有更新"检测状态\n• 清除全部记录：删除 ZIP 文件并重置"有更新"检测状态\n\n（不会影响已安装的插件）', [
          { text: '仅清除压缩包', primary: true, onClick: function () { doClear(false); } },
          { text: '清除全部记录', danger: true, onClick: function () { doClear(true); } }
        ]);
      }

      function parseResp(r) {
        var ct = r.headers.get('content-type') || '';
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error('HTTP ' + r.status + (t ? ': ' + t : ''));
          });
        }
        if (ct.indexOf('application/json') !== -1) return r.json();
        return r.text().then(function (t) { throw new Error('非 JSON 响应: ' + (t.slice(0, 200) || '(空)')); });
      }

      function showConfirm(title, desc, actions) {
        // actions: [{ text, primary?, onClick, danger? }]
        var overlay = document.createElement('div');
        overlay.className = 'dsh-sync-modal-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;z-index:2147483647;backdrop-filter:blur(2px);';

        var modal = document.createElement('div');
        modal.className = 'dsh-sync-modal';
        modal.style.cssText = 'background:var(--dsw-alias-bg-module-platform,#fff);border-radius:16px;padding:24px;width:min(460px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.25);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);';
        modal.onclick = function (e) { e.stopPropagation(); };

        var t = document.createElement('h3');
        t.textContent = title;
        t.style.cssText = 'font-size:16px;font-weight:700;margin:0 0 8px;color:var(--dsw-alias-label-primary,#17212b);';
        modal.appendChild(t);

        var d = document.createElement('p');
        d.textContent = desc;
        d.style.cssText = 'font-size:13px;color:var(--dsw-alias-label-tertiary,#64748b);margin:0 0 18px;line-height:1.6;white-space:pre-wrap;';
        modal.appendChild(d);

        var actionsBar = document.createElement('div');
        actionsBar.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;';
        modal.appendChild(actionsBar);

        function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }

        function makeBtn(spec) {
          var b = document.createElement('button');
          b.textContent = spec.text;
          b.style.cssText = 'padding:8px 16px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);background:var(--dsw-alias-bg-module-platform,#fff);color:var(--dsw-alias-label-primary,#17212b);border-radius:10px;font-size:13px;cursor:pointer;transition:all .15s;white-space:nowrap;font-weight:500;';
          if (spec.primary) {
            b.style.background = 'var(--dsw-alias-brand-primary,#2563eb)';
            b.style.borderColor = 'var(--dsw-alias-brand-primary,#2563eb)';
            b.style.color = '#fff';
            b.style.fontWeight = '600';
            b.style.boxShadow = '0 2px 8px rgba(37,99,235,.3)';
          }
          if (spec.danger) {
            b.style.background = 'var(--dsw-alias-color-error,#dc2626)';
            b.style.borderColor = 'var(--dsw-alias-color-error,#dc2626)';
            b.style.color = '#fff';
            b.style.fontWeight = '600';
          }
          b.onmouseenter = function () { b.style.transform = 'translateY(-1px)'; };
          b.onmouseleave = function () { b.style.transform = ''; };
          b.onclick = function () { close(); if (spec.onClick) spec.onClick(); };
          return b;
        }

        actionsBar.appendChild(makeBtn({ text: '取消', onClick: null }));
        (actions || []).forEach(function (a) { actionsBar.appendChild(makeBtn(a)); });

        overlay.onclick = close;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
      }

      function openDirDialog() {
        var overlay = document.createElement('div');
        overlay.className = 'dsh-sync-modal-overlay';
        overlay.style.cssText = 'position:absolute;top:' + window.scrollY + 'px;left:' + window.scrollX + 'px;width:' + window.innerWidth + 'px;height:' + window.innerHeight + 'px;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;z-index:2147483647;backdrop-filter:blur(2px);';
        var onScroll = function () {
          overlay.style.top = window.scrollY + 'px';
          overlay.style.left = window.scrollX + 'px';
        };
        window.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onScroll);

        var modal = document.createElement('div');
        modal.className = 'dsh-sync-modal';
        modal.style.cssText = 'background:var(--dsw-alias-bg-module-platform,#fff);border-radius:16px;padding:24px;width:min(480px,92vw);box-shadow:0 20px 60px rgba(0,0,0,.25);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);';
        modal.onclick = function (e) { e.stopPropagation(); };

        var title = document.createElement('h3');
        title.textContent = '输出目录';
        title.style.cssText = 'font-size:16px;font-weight:700;margin:0 0 6px;color:var(--dsw-alias-label-primary,#17212b);';
        modal.appendChild(title);

        var desc = document.createElement('p');
        desc.textContent = '设置 ZIP 打包文件的保存目录，留空使用默认目录。';
        desc.style.cssText = 'font-size:13px;color:var(--dsw-alias-label-tertiary,#64748b);margin:0 0 16px;line-height:1.5;';
        modal.appendChild(desc);

        var input = document.createElement('input');
        input.type = 'text';
        input.value = outputDir || '';
        input.placeholder = '留空使用默认目录（~/.dsh/dsh-plugin-offline-sync/）';
        input.style.cssText = 'width:100%;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;background:var(--dsw-alias-bg-input,#fff);color:var(--dsw-alias-label-primary,#17212b);font-size:13px;outline:none;box-sizing:border-box;transition:border-color .15s,box-shadow .15s;';
        input.onfocus = function () { input.style.borderColor = 'var(--dsw-alias-brand-primary,#2563eb)'; input.style.boxShadow = '0 0 0 3px rgba(37,99,235,.12)'; };
        input.onblur = function () { input.style.borderColor = ''; input.style.boxShadow = ''; };
        input.onkeydown = function (e) { if (e.key === 'Enter') doConfirm(); else if (e.key === 'Escape') doClose(); };
        modal.appendChild(input);

        var actions = document.createElement('div');
        actions.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:18px;';
        modal.appendChild(actions);

        function makeBtn(text, primary, onClick) {
          var b = document.createElement('button');
          b.textContent = text;
          b.style.cssText = 'padding:8px 16px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);background:var(--dsw-alias-bg-module-platform,#fff);color:var(--dsw-alias-label-primary,#17212b);border-radius:10px;font-size:13px;cursor:pointer;transition:all .15s;white-space:nowrap;font-weight:500;';
          if (primary) {
            b.style.background = 'var(--dsw-alias-brand-primary,#2563eb)';
            b.style.borderColor = 'var(--dsw-alias-brand-primary,#2563eb)';
            b.style.color = '#fff';
            b.style.fontWeight = '600';
            b.style.boxShadow = '0 2px 8px rgba(37,99,235,.3)';
          }
          b.onmouseenter = function () { b.style.transform = 'translateY(-1px)'; };
          b.onmouseleave = function () { b.style.transform = ''; };
          b.onclick = onClick;
          return b;
        }

        actions.appendChild(makeBtn('打开目录', false, openOutput));
        actions.appendChild(makeBtn('取消', false, doClose));
        actions.appendChild(makeBtn('确定', true, doConfirm));

        function doClose() {
          window.removeEventListener('scroll', onScroll, true);
          window.removeEventListener('resize', onScroll);
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }
        function doConfirm() {
          setOutputDir(input.value.trim());
          doClose();
        }

        overlay.onclick = doClose;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        setTimeout(function () { input.focus(); }, 0);
      }

      var plugins = (data && data.plugins) || [];
      var count = Object.keys(selected).length;

      return h('div', { className: 'dsh-sync-root' },
        h('div', { className: 'dsh-sync-header' },
          h('div', { className: 'dsh-sync-header-icon' }, '📦'),
          h('div', null,
            h('h2', { className: 'dsh-sync-title' }, '离线打包同步'),
            h('div', { className: 'dsh-sync-subtitle' },
              '选择本地插件打包为 ZIP，拷贝到其他机器后运行 install.cjs 即可安装。'
            )
          )
        ),

        h('div', { className: 'dsh-sync-card' },
          h('div', { className: 'dsh-sync-card-title' }, '选择插件'),
          h('div', { className: 'dsh-sync-toolbar' },
            h('div', { className: 'dsh-sync-toolbar-left' },
              h('button', { className: 'dsh-sync-btn', onClick: selectAll }, '全选'),
              h('button', { className: 'dsh-sync-btn', onClick: selectChanged }, '仅选有更新'),
              h('button', { className: 'dsh-sync-btn', onClick: selectNone }, '清空')
            ),
            h('div', { className: 'dsh-sync-toolbar-right' },
              h('span', { className: 'dsh-sync-count' }, '已选 ', h('b', null, count), ' 个插件'),
              h('button', {
                className: 'dsh-sync-btn' + (clearing ? ' dsh-sync-clearing' : ''),
                onClick: clearHistory,
                disabled: clearing
              }, clearing ? '清除中...' : '🗑 清除历史'),
              h('button', { className: 'dsh-sync-btn', onClick: openDirDialog }, '📁 输出目录'),
              h('button', {
                onClick: pack,
                disabled: packing || count === 0,
                className: 'dsh-sync-btn primary'
              }, packing ? '打包中...' : '开始打包')
            )
          ),

          error && h('div', { className: 'dsh-sync-alert error' }, error),
          info && h('div', { className: 'dsh-sync-alert success' }, info),

          h('div', { className: 'dsh-sync-grid' },
            loading ? h('div', { className: 'dsh-sync-empty' }, '加载中...') :
            plugins.length === 0 ? h('div', { className: 'dsh-sync-empty' }, '未发现插件') :
            plugins.map(function (p) {
              var checked = !!selected[p.name];
              return h('div', {
                key: p.name,
                onClick: function () { toggle(p.name); },
                className: 'dsh-sync-item' + (checked ? ' selected' : '')
              },
                h('input', { type: 'checkbox', checked: checked, onChange: function () {} }),
                h('button', {
                  className: 'dsh-sync-exclude-btn',
                  title: '排除此插件',
                  onClick: function (e) { e.stopPropagation(); excludePlugin(p.name); }
                }, '⊘'),
                h('div', { className: 'dsh-sync-item-main' },
                  h('div', { className: 'dsh-sync-item-name' },
                    p.name,
                    p.version ? h('span', { className: 'dsh-sync-badge version' }, p.version) : null,
                    p.changed ? h('span', { className: 'dsh-sync-badge changed' }, '有更新') : null
                  ),
                  p.description ? h('div', { className: 'dsh-sync-item-desc' }, p.description) : null
                )
              );
            })
          ),

          (function () {
            var excluded = (data && data.excluded) || [];
            if (excluded.length === 0) return null;
            return h('div', { className: 'dsh-sync-excluded-section' },
              h('div', { className: 'dsh-sync-excluded-title' },
                h('span', null, '已排除的插件（' + excluded.length + '）'),
                h('button', { className: 'dsh-sync-btn', style: { padding: '4px 10px', fontSize: '12px' }, onClick: restoreAll }, '全部恢复')
              ),
              h('div', { className: 'dsh-sync-excluded-list' },
                excluded.map(function (p) {
                  return h('span', { key: p.name, className: 'dsh-sync-excluded-tag' },
                    p.name + (p.version ? ' @' + p.version : ''),
                    h('button', { onClick: function () { restorePlugin(p.name); } }, '恢复')
                  );
                })
              )
            );
          })()

        ),

        h('div', { className: 'dsh-sync-help' },
          h('h4', null, '使用说明'),
          h('ol', null,
            h('li', null, '勾选需要打包的插件，"有更新"标记表示自上次打包后有变化'),
            h('li', null, '点击"开始打包"生成 ZIP 文件'),
            h('li', null, '将 ZIP 拷贝到目标机器，解压后运行 ', h('code', null, 'node install.cjs')),
            h('li', null, '安装脚本会自动检测目标机器已有版本并询问是否更新')
          )
        )
      );
    }

    exports.apply = function (ctx) {
      window.__dsh_sync_ctx = ctx;
      ensureStyles();

      var cleanups = [];

      // 注册到插件页面标签（左侧导航栏的"插件"页面）
      try {
        var off1 = ctx.slots.inject('plugins.tab', function () {
          return ctx.slots.register({
            name: 'plugins.tab',
            id: 'dsh-plugin-offline-sync',
            order: 90,
            label: '离线打包同步',
            inject: function () { return {}; }
          }, function () {
            return h(SyncPanel);
          });
        });
        cleanups.push(off1);
      } catch (e) { /* plugins.tab not available on this host */ }

      // 同时注册到设置页的插件标签（兼容旧版）
      try {
        var off2 = ctx.slots.inject('settings.plugins.tab', function () {
          return ctx.slots.register({
            name: 'settings.plugins.tab',
            id: 'dsh-plugin-offline-sync',
            order: 90,
            label: '离线打包同步',
            inject: function () { return {}; }
          }, function () {
            return h(SyncPanel);
          });
        });
        cleanups.push(off2);
      } catch (e) { /* settings.plugins.tab not available on this host */ }

      return function () { cleanups.forEach(function (c) { if (typeof c === 'function') c(); }); };
    };

    return module.exports;
  }
});
