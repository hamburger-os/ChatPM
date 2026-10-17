import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {listPmRegisters,readPmIssueHistory,
  readPmChangeImplementationHistory,listPmTaskDependencies} from
  '../../../packages/core/src/governance/pm-register-query.ts';
import {pmEntryKind,pmCreateDefinitions,createPmEntry,reassignPmDeliverable,
  submitPmDeliverable,reviewPmDeliverable,transitionPmIssue,decidePmChange,
  updatePmChangeImplementation,createPmTaskDependency} from
  '../../../packages/core/src/governance/pm-register-commands.ts';

const uuid=z.string().uuid();
function context(req:FastifyRequest){
  return uuid.parse((req.params as {projectId:string}).projectId);
}
export function registerPmRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.get('/projects/:projectId/pm',async req=>{
    const projectId=context(req),actorId=await authenticated(req);
    return listPmRegisters(projectId,actorId);
  });

  app.post('/projects/:projectId/pm/:kind',async (req,reply)=>{
    const projectId=context(req),kind=pmEntryKind.parse((req.params as {kind:string}).kind);
    const user=await authenticated(req);
    const input=pmCreateDefinitions[kind].schema.parse(req.body) as Record<string,unknown>;
    const result=await createPmEntry(projectId,user,kind,input);
    return reply.code(201).send(result);
  });

  const versioned=z.object({idempotencyKey:uuid,expectedVersion:z.number().int().positive()});
  const historyPage=z.object({beforeVersion:z.coerce.number().int().positive().max(2147483647).optional()});
  const reassignSchema=versioned.extend({
    assigneeId:uuid,note:z.string().trim().min(1).max(2000),
  });
  app.post('/projects/:projectId/pm/deliverables/:itemId/reassign',async req=>{
    const projectId=context(req),actor=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=reassignSchema.parse(req.body);
    return reassignPmDeliverable(projectId,id,actor,input);
  });

  app.post('/projects/:projectId/pm/deliverables/:itemId/submit',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=versioned.parse(req.body);
    return submitPmDeliverable(projectId,id,user,input);
  });

  const reviewSchema=versioned.extend({decision:z.enum(['accept','return'])});
  app.post('/projects/:projectId/pm/deliverables/:itemId/review',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=reviewSchema.parse(req.body);
    return reviewPmDeliverable(projectId,id,user,input);
  });

  // Issue is an occurred problem, not a prospective risk. State changes
  // require a human explanation and retain append-only, project-scoped history.
  const issueTransitionSchema=versioned.extend({
    decision:z.enum(['resolve','reopen']),
    note:z.string().trim().min(1).max(2000),
  });
  app.post('/projects/:projectId/pm/issues/:itemId/transition',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=issueTransitionSchema.parse(req.body);
    return transitionPmIssue(projectId,id,user,input);
  });

  app.get('/projects/:projectId/pm/issues/:itemId/history',async req=>{
    const projectId=context(req),actorId=await authenticated(req);
    const issueId=uuid.parse((req.params as {itemId:string}).itemId);
    const {beforeVersion}=historyPage.parse(req.query);
    return readPmIssueHistory(projectId,issueId,actorId,beforeVersion);
  });

  const decisionSchema=versioned.extend({decision:z.enum(['approve','reject'])});
  app.post('/projects/:projectId/pm/changes/:itemId/decide',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=decisionSchema.parse(req.body);
    return decidePmChange(projectId,id,user,input);
  });

  // An approved ChangeRequest is not an implemented baseline change.
  // Only a human execution owner may author post-start message evidence,
  // verified by a different active project owner/manager.
  const implementationSchema=z.discriminatedUnion('decision',[
    versioned.extend({decision:z.literal('start'),ownerId:uuid,
      note:z.string().trim().min(1).max(2000)}),
    versioned.extend({decision:z.literal('reassign'),ownerId:uuid,
      note:z.string().trim().min(1).max(2000)}),
    versioned.extend({decision:z.literal('complete'),evidenceMessageId:uuid,
      note:z.string().trim().min(1).max(2000)}),
  ]);
  app.post('/projects/:projectId/pm/changes/:itemId/implementation',async req=>{
    const projectId=context(req),user=await authenticated(req);
    const id=uuid.parse((req.params as {itemId:string}).itemId);
    const input=implementationSchema.parse(req.body);
    return updatePmChangeImplementation(projectId,id,user,input);
  });

  app.get('/projects/:projectId/pm/changes/:itemId/implementation/history',
    async req=>{
      const projectId=context(req),actorId=await authenticated(req);
      const changeId=uuid.parse((req.params as {itemId:string}).itemId);
      const {beforeVersion}=historyPage.parse(req.query);
      return readPmChangeImplementationHistory(
        projectId,changeId,actorId,beforeVersion);
    });

  const dependencySchema=z.object({
    idempotencyKey:uuid,dependentTaskId:uuid,prerequisiteTaskId:uuid,
  }).refine(x=>x.dependentTaskId!==x.prerequisiteTaskId,'任务不能依赖自身');
  app.get('/projects/:projectId/pm/dependencies',async req=>{
    const projectId=context(req),actorId=await authenticated(req);
    return listPmTaskDependencies(projectId,actorId);
  });
  app.post('/projects/:projectId/pm/dependencies',async(req,reply)=>{
    const projectId=context(req),user=await authenticated(req);
    const input=dependencySchema.parse(req.body);
    const result=await createPmTaskDependency(projectId,user,input);
    return reply.code(201).send(result);
  });
}
