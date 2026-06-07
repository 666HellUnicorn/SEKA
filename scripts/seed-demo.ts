import { AuthService } from "../src/server/auth.ts";
import { KnowledgeAgent } from "../src/server/agent.ts";
import { KnowledgeBase } from "../src/server/core.ts";
import { Database } from "../src/server/db.ts";

const db = new Database();
const auth = new AuthService(db);
const kb = new KnowledgeBase(db);
const agent = new KnowledgeAgent(kb);

async function seed() {
  const existingTitles = new Set(kb.listDocuments().map((doc) => doc.title));
  const samples = [
    {
      title: "SEKA 项目定位",
      workspace: "resume",
      tags: ["resume", "agent", "rag"],
      description: "用于简历和面试展示的项目定位说明。",
      content: [
        "# SEKA 项目定位",
        "",
        "SEKA 是一个可本地部署的个人与企业知识库 Agent。",
        "核心目标是把分散资料沉淀为可检索、可追溯、可反馈迭代的知识系统。",
        "项目使用 TypeScript 全栈实现，覆盖上传、解析、切块、混合检索、RAG 问答、引用来源、权限和审计。",
        "",
        "简历亮点：本地私有化、答案可溯源、知识可持续更新、Agent 工具调用记录、RBAC 和 Docker 交付。",
      ].join("\n"),
    },
    {
      title: "公司知识库使用规范",
      workspace: "company",
      tags: ["company", "policy", "workflow"],
      description: "演示公司知识库的空间隔离与流程规范。",
      content: [
        "# 公司知识库使用规范",
        "",
        "所有项目文档应标注 workspace、tags 和 description，便于后续检索。",
        "重要决策需要保留背景、选项、取舍、结论和负责人。",
        "客服、研发和运营常见问题应沉淀为 FAQ，并定期通过反馈修正工作台更新。",
        "viewer 角色只能读取知识；editor 可以上传和修正知识；admin 可以管理用户和审计日志。",
      ].join("\n"),
    },
    {
      title: "知识迭代闭环说明",
      workspace: "product",
      tags: ["feedback", "iteration", "product"],
      description: "演示反馈如何重新进入知识库。",
      content: [
        "# 知识迭代闭环说明",
        "",
        "用户每次问答后可以提交 correct、wrong 或 save 类型反馈。",
        "wrong 反馈会进入修正工作台，处理人可以填写正确结论并保存为修正知识。",
        "save 反馈会把高质量问答直接沉淀为新的 Markdown 文档并重新索引。",
        "这个机制让知识库从静态资料库升级为可持续演进的知识系统。",
      ].join("\n"),
    },
  ];

  for (const sample of samples) {
    if (existingTitles.has(sample.title)) {
      console.log(`跳过已存在文档：${sample.title}`);
      continue;
    }
    const doc = await kb.ingestTextKnowledge(sample.title, sample.content, "demo_seed", {
      workspace: sample.workspace,
      tags: sample.tags,
      description: sample.description,
    });
    console.log(`已创建演示文档：${doc.title} (${doc.workspace}, ${doc.chunkCount} chunks)`);
  }

  const adminSession = auth.login(process.env.SEKA_ADMIN_USERNAME ?? "admin", process.env.SEKA_ADMIN_PASSWORD ?? "admin123");
  auth.audit(adminSession.user, "demo.seed", "demo", "seed-demo");
  const run = await agent.run("总结 SEKA 作为简历项目的亮点", { workspace: "resume", topK: 5 });
  console.log("\n演示 Agent 输出：");
  console.log(run.answer);
  console.log("\nDemo seed completed.");
}

try {
  await seed();
} finally {
  kb.close();
}
