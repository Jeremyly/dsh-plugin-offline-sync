window.__ModuleLoader__.load({
  id: 'dsh-plugin-offline-sync',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    exports.inject = ['slots'];

    var STYLE_ID = 'dsh-plugin-offline-sync-styles-v1';

    function ensureStyles() {
      if (document.getElementById(STYLE_ID)) return;
      var styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = [
        '.dsh-sync-root{padding:20px;max-width:960px;font-family:var(--dsw-font-family-base,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);color:var(--dsw-alias-label-primary,#17212b)}',
        '.dsh-sync-header{margin-bottom:20px}',
        '.dsh-sync-title{font-size:20px;font-weight:600;margin:0 0 6px;color:var(--dsw-alias-label-primary,#17212b)}',
        '.dsh-sync-subtitle{font-size:13px;color:var(--dsw-alias-label-tertiary,#64748b);line-height:1.5}',
        '.dsh-sync-card{background:var(--dsw-alias-bg-module-platform,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:12px;padding:16px;margin-bottom:16px}',
        '.dsh-sync-card-title{font-size:14px;font-weight:600;margin:0 0 12px;color:var(--dsw-alias-label-primary,#17212b)}',
        '.dsh-sync-row{display:flex;gap:10px;align-items:center}',
        '.dsh-sync-label{font-size:13px;color:var(--dsw-alias-label-secondary,#475569);min-width:72px;flex-shrink:0}',
        '.dsh-sync-input{flex:1;padding:7px 10px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:8px;background:var(--dsw-alias-bg-input,#fff);color:var(--dsw-alias-label-primary,#17212b);font-size:13px;outline:none;transition:border-color .15s}',
        '.dsh-sync-input:focus{border-color:var(--dsw-alias-brand-primary,#2563eb)}',
        '.dsh-sync-btn{padding:7px 14px;border:1px solid var(--dsw-alias-border-l2,#e2e8f0);background:var(--dsw-alias-bg-module-platform,#fff);color:var(--dsw-alias-label-primary,#17212b);border-radius:8px;font-size:13px;cursor:pointer;transition:background .15s,border-color .15s;white-space:nowrap}',
        '.dsh-sync-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f1f5f9)}',
        '.dsh-sync-btn.primary{background:var(--dsw-alias-brand-primary,#2563eb);border-color:var(--dsw-alias-brand-primary,#2563eb);color:#fff;font-weight:600}',
        '.dsh-sync-btn.primary:hover{background:var(--dsw-alias-brand-primary-hover,#1d4ed8);border-color:var(--dsw-alias-brand-primary-hover,#1d4ed8)}',
        '.dsh-sync-btn:disabled{opacity:.5;cursor:not-allowed}',
        '.dsh-sync-toolbar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}',
        '.dsh-sync-alert{padding:10px 14px;border-radius:8px;font-size:13px;margin-bottom:12px;line-height:1.5}',
        '.dsh-sync-alert.error{background:rgba(239,68,68,.08);color:var(--dsw-alias-color-error,#b91c1c);border:1px solid rgba(239,68,68,.2)}',
        '.dsh-sync-alert.success{background:rgba(34,197,94,.08);color:var(--dsw-alias-color-success,#166534);border:1px solid rgba(34,197,94,.2);white-space:pre-wrap}',
        '.dsh-sync-list{border:1px solid var(--dsw-alias-border-l2,#e2e8f0);border-radius:10px;overflow:hidden;background:var(--dsw-alias-bg-module-platform,#fff)}',
        '.dsh-sync-item{display:flex;gap:12px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1,#f1f5f9);cursor:pointer;transition:background .12s;align-items:flex-start}',
        '.dsh-sync-item:last-child{border-bottom:none}',
        '.dsh-sync-item:hover{background:var(--dsw-alias-interactive-bg-hover,#f8fafc)}',
        '.dsh-sync-item.selected{background:rgba(37,99,235,.06)}',
        '.dsh-sync-item input[type=checkbox]{margin-top:3px;width:16px;height:16px;accent-color:var(--dsw-alias-brand-primary,#2563eb);cursor:pointer}',
        '.dsh-sync-item-main{flex:1;min-width:0}',
        '.dsh-sync-item-name{font-weight:600;font-size:14px;color:var(--dsw-alias-label-primary,#17212b);display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
        '.dsh-sync-badge{font-size:11px;padding:2px 8px;border-radius:10px;background:var(--dsw-alias-bg-tag,#e5e7eb);color:var(--dsw-alias-label-tertiary,#64748b);font-weight:500}',
        '.dsh-sync-badge.changed{background:rgba(245,158,11,.12);color:var(--dsw-alias-color-warning,#92400e)}',
        '.dsh-sync-badge.version{background:var(--dsw-alias-bg-tag,#e5e7eb);color:var(--dsw-alias-label-secondary,#475569)}',
        '.dsh-sync-item-desc{color:var(--dsw-alias-label-tertiary,#64748b);font-size:12px;margin-top:3px;line-height:1.4}',
        '.dsh-sync-empty{padding:32px;text-align:center;color:var(--dsw-alias-label-tertiary,#64748b);font-size:13px}',
        '.dsh-sync-footer{display:flex;justify-content:space-between;align-items:center;margin-top:16px}',
        '.dsh-sync-count{font-size:13px;color:var(--dsw-alias-label-tertiary,#64748b)}',
        '.dsh-sync-count b{color:var(--dsw-alias-brand-primary,#2563eb)}',
        '.dsh-sync-help{margin-top:20px;padding:14px 18px;background:var(--dsw-alias-bg-module-sub,#f9fafb);border-radius:10px;font-size:12px;color:var(--dsw-alias-label-secondary,#475569);border:1px solid var(--dsw-alias-border-l2,#e2e8f0)}',
        '.dsh-sync-help h4{margin:0 0 10px;font-size:13px;color:var(--dsw-alias-label-primary,#17212b)}',
        '.dsh-sync-help ol{margin:0;padding-left:20px;line-height:1.8}',
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

      var plugins = (data && data.plugins) || [];
      var count = Object.keys(selected).length;

      return h('div', { className: 'dsh-sync-root' },
        h('div', { className: 'dsh-sync-header' },
          h('h2', { className: 'dsh-sync-title' }, '离线打包同步'),
          h('div', { className: 'dsh-sync-subtitle' },
            '选择本地插件打包为 ZIP，拷贝到其他机器后运行 install.cjs 即可安装。'
          )
        ),

        h('div', { className: 'dsh-sync-card' },
          h('div', { className: 'dsh-sync-card-title' }, '输出目录'),
          h('div', { className: 'dsh-sync-row' },
            h('input', {
              type: 'text', className: 'dsh-sync-input',
              value: outputDir,
              onChange: function (e) { setOutputDir(e.target.value); },
              placeholder: '留空使用默认目录（~/.dsh/dsh-plugin-offline-sync/）'
            }),
            h('button', { className: 'dsh-sync-btn', onClick: openOutput }, '打开目录')
          )
        ),

        h('div', { className: 'dsh-sync-card' },
          h('div', { className: 'dsh-sync-card-title' }, '选择插件'),
          h('div', { className: 'dsh-sync-toolbar' },
            h('button', { className: 'dsh-sync-btn', onClick: selectAll }, '全选'),
            h('button', { className: 'dsh-sync-btn', onClick: selectChanged }, '仅选有更新'),
            h('button', { className: 'dsh-sync-btn', onClick: selectNone }, '清空')
          ),

          error && h('div', { className: 'dsh-sync-alert error' }, error),
          info && h('div', { className: 'dsh-sync-alert success' }, info),

          h('div', { className: 'dsh-sync-list' },
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

          h('div', { className: 'dsh-sync-footer' },
            h('span', { className: 'dsh-sync-count' }, '已选 ', h('b', null, count), ' 个插件'),
            h('button', {
              onClick: pack,
              disabled: packing || count === 0,
              className: 'dsh-sync-btn primary'
            }, packing ? '打包中...' : '开始打包')
          )
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
