/** Render human-readable reminders using the project's local calendar days. */
export function reminderCopy(input:{
  displayName:string;
  title:string;
  daysUntilDue:number;
  blocked:boolean;
}):string{
  const {displayName,title,daysUntilDue,blocked}=input;
  const category=blocked?'【阻塞需关注】':daysUntilDue<0?'【已逾期】':
    daysUntilDue<=3?'【临近截止】':'【阶段进展检查】';
  const deadline=daysUntilDue<0?`已逾期 ${-daysUntilDue} 天`:
    daysUntilDue===0?'今天截止':`距截止还有 ${daysUntilDue} 天`;
  return `@${displayName}，${category}任务「${title}」${deadline}。`+
    '请更新已完成成果、剩余工作、阻塞和预计交付日期。';
}
