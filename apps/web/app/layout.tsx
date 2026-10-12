import type { Metadata } from 'next';
import './globals.css';

export const metadata:Metadata={
  title:'ChatPM · AI 项目经理',
  description:'团队群聊、可信任务跟进、AI 风险提取与项目汇报',
};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
