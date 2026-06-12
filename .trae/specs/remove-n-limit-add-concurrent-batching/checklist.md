# 检查清单

- [x] Task 1: paramCompatibility.ts 中已移除上限常量，getOutputImageLimitForSettings 返回 Infinity，normalizeParamsForSettings 不再截断 n
- [x] Task 2: InputBar.tsx 中 commitN 不再截断 n，超限提示和拦截逻辑已移除，文案已更新
- [x] Task 3: store.ts 普通模式已改为按批次并发（每批最多 20），所有批次完成后汇总
- [x] Task 4: store.ts 文件夹模式已改为按批次并发（每批最多 20），所有批次完成后汇总
- [x] Task 5: paramCompatibility.test.ts 中的上限测试已更新，新增无上限验证
- [x] Task 6: 所有测试通过（npm run test），TypeScript 编译无错误（npm run tsc）