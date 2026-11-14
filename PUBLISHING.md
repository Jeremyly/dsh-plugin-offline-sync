# 收录到 DSH 插件市场（awesome-dsh-plugin）指南

## 收录源

插件市场的数据源是 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
提交方式是向该仓库发一个 PR，**只加一个 YAML 文件**。

## 前置条件（全部满足才能提交 PR）

- [ ] 仓库 `package.json` 声明 `dsh.bundle`（不只是 `dsh.client`）— **已满足**
- [ ] 仓库已推送到 GitHub — **已满足**（https://github.com/Jeremyly/dsh-plugin-offline-sync）
- [ ] 仓库创建满 1 天
- [ ] 提交数 ≥ 10
- [ ] 仓库有 `dsh-plugin` topic（仓库页 → About → 齿轮 → 添加）

## 收录文件

文件名：`data/plugins/Jeremyly__dsh-plugin-offline-sync.yml`（双下划线分隔 owner 和 repo）

```yaml
url: https://github.com/Jeremyly/dsh-plugin-offline-sync
name: Jeremyly/dsh-plugin-offline-sync
category: tools
description:
  en: 'Package local DSH plugins into a portable ZIP, and install them offline on other machines with version detection and incremental packing.'
  zh: '将本地 DSH 插件打包为可便携的 ZIP，在其他机器上离线安装，支持版本检测与增量打包。'
```

## 提交步骤

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`
2. 在 fork 中新建文件 `data/plugins/Jeremyly__dsh-plugin-offline-sync.yml`，内容如上
3. 运行 `node scripts/generate-readme.mjs` 重新生成 README，并提交
4. 提交 PR，按模板勾选：
   - 我新增了一个 `data/plugins/<owner>__<repo>.yml` 文件
   - 我已运行 `node scripts/generate-readme.mjs` 并提交
   - package.json 声明了 `dsh.bundle`
   - 仓库创建满 1 天且提交数 ≥ 10
   - category 取值正确
   - 描述只说功能，不带营销词
   - 仓库有 `dsh-plugin` topic

## category 可选值

`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools` `wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev` `security` `remote` `market` `fun`

本插件选 `tools`。

## 参考

- 官方投稿指南：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md
