<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

Players:

- `编码者`
- `审查者`

用两个agent来完成输入的任务：

1. 确认当前目录是一个Git仓库；若不是，则将其初始化为Git仓库。
2. `编码者`按任务要求对当前目录的代码进行修改并提交Git。
3. `审查者`对提交的commit进行review并提出合理问题，交回给`编码者`做判断。
4. `编码者`可以接受或拒绝但要讲清楚原因。
5. 两个agent争论直至达成一致。
6. 由`编码者`负责按结论修改代码，再次提交。
7. 依此循环，直到review没有任何问题后结束。
