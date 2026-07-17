<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- SPDX-FileCopyrightText: 2026 SubLang International <https://sublang.ai> -->

用两个agent来完成输入的任务，一个agent按任务要求对当前目录的代码进行修改并提交Git，另一个agent对提交的commit进行review并提出合理问题，交回给第一个agent做判断，它可以接受或拒绝但要讲清楚原因，两个agent争论直至达成一致，由第一个agent负责按结论修改代码，再次提交。依此循环，直到review没有任何问题后结束。
