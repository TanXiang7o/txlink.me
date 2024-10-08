---
title: RocketMQ毫秒级定时任务方案
date: '2024-10-05'
lastmod: '2024-10-08'
tags: ["RocketMQ", "定时任务", "毫秒级精度", "流控机制", "时间轮"]
draft: false
summary: '探索RocketMQ的新定时任务方案，提供毫秒级精度与流控机制'
authors: ['default']
---

# RocketMQ毫秒级定时任务方案

在[RIP-43](https://docs.google.com/document/d/1D6XWwY39p531c2aVi5HQll9iwzTUNT1haUFHqMoRkT0/edit#heading=h.d7x9otgla1zw)之前，RocketMQ只支持固定时间长度的定时消息，且最大的定时时间默认只有两小时。其实现原理是：

对于定时消息，先将其Topic改为一个固定的定时Topic，该定时Topic有多个队列，每个队列代表一个定时时间，定时时间相同的消息放在同一个队列中，用周期性任务去扫描到期的消息，然后恢复其真正的Topic和QueueId，在重新投递到CommitLog中，于是消费者才可见。

该方案的缺点是：

- 不支持任意时长的定时任务。如果在原方案上拓展到任意时长，秒级的精度的话，一天的时间窗口就需要1\*24\*3600个队列……
- 定时的存储和老化：RocketMQ的消息默认老化时间是3天，这意味着延迟时间超过3天就可能永远无法再投递。
- 原先的方案没有流控机制，如果同时有大量定时消息，会对RocketMQ造成极大压力。

## 总体方案

### 两个关键数据结构

#### TimeLog

Timelog是只读的，每条消息包含一个prev_pos，指向前一条定时到同样时刻的消息的记录。其中包含了消息在CommitLog中的偏移量以及真正的Topic。其主要属性如下：

```java
public final static int BLANK_MAGIC_CODE = 0xBBCCDDEE ^ 1880681586 + 8; // 用于标识空白记录的魔术码
private final static int MIN_BLANK_LEN = 4 + 8 + 4; // 空白记录的最小长度
public final static int UNIT_SIZE = 4  //size 保存记录的大小
        + 8 //prev pos  前一条记录的位置
        + 4 //magic value
        + 8 //curr write time, for trace    记录写入时间
        + 4 //delayed time, for check   定时时间
        + 8 //offsetPy  消息在commitLog中的偏移量
        + 4 //sizePy    消息在commitLog中的大小
        + 4 //hash code of real topic   消息真实Topic的hash值
        + 8; //reserved value, just in case of  保留字段
public final static int UNIT_PRE_SIZE_FOR_MSG = 28; //
public final static int UNIT_PRE_SIZE_FOR_METRIC = 40;
private final MappedFileQueue mappedFileQueue; // 映射文件队列，即TimeLog的存储位置，由多个mappedFile组成
```

假设一个（TimeLog）mappedFile的大小是1024B，而一个消息记录的大小是52B，那么该mappedFile就是由1024/52=19个记录，加一个空白记录组成，如果前一个mappedFile满了，就会创建一个新的mappedFile。

#### TimeWheel

TimeWheel是时间轮，对时刻表的一种抽象，通常基于数组实现。其中两个最重要的属性是slotsTotal和precisionMs，分别代表时间槽的数量和定时精度。在RocketMQ中，slotsTotal默认是7\*24\*3600，与精度无关。precisionMs是以毫秒为单位的，所以支持毫秒级的定时精度。其主要属性如下：

```java
public static final int BLANK = -1, IGNORE = -2;
public final int slotsTotal;
public final int precisionMs;
private String fileName;
private final RandomAccessFile randomAccessFile;
private final FileChannel fileChannel;
private final MappedByteBuffer mappedByteBuffer;
private final ByteBuffer byteBuffer;
//在threadlocal中存byteBuffer的副本，新缓冲区的容量、限制、位置和标记值将与byteBuffer的容量、限制、位置和标记值相同
private final ThreadLocal<ByteBuffer> localBuffer = new ThreadLocal<ByteBuffer>() {
    @Override
    protected ByteBuffer initialValue() {
        return byteBuffer.duplicate();
    }
};
private final int wheelLength;
```

具体的扫描时间轮流程如图所示：

![img](/static/images/202410/AD_4nXdLWgJzizmloHUDoi2HNKFuddvzGeAz1UgtYQ7_E_HGLZBHTH9_VlWSAo2l_MuwEdMTrStw5NmMYd4KveA-ito59SOUiZEpM5Rv4Sr3GEQ6k1XlasvYDiH7kIMGg39UHV5wGhLJqc4vDdmaRRY902Nbefg.png)

### 定时消息投递步骤

定时消息主要的逻辑可以分为**保存**和**投递**两个阶段，[RIP-43](https://docs.google.com/document/d/1D6XWwY39p531c2aVi5HQll9iwzTUNT1haUFHqMoRkT0/edit#heading=h.d7x9otgla1zw)将每个节点都拆分成不同的任务（服务线程），用生产-消费模式衔接每个任务，实现任务的解耦和流控。

![img](/static/images/202410/AD_4nXfS88XxiEulSbGql9rgCQzFY5Fms1oJ1avfSn7z8wAuCh5CDW-xUrUSyKA-f0JWf9ldzDf216SE6D0OFAxJ1BL-xb4I-Cm4BFftm3SMcocoQJ9_GPzDmriCmY60nw0Jo3VKcn6CkTKdc9J6yp1wvVEemoc.png)

如上图所示，带有 enqueue 的为定时消息保存的线程和队列，带有 dequeue 的为定时消息投递的线程和队列。

#### 定时消息保存

定时消息在被保存到 CommitLog 前，会检查其的属性，如果消息属性中包含定时属性，则会将真正要投递的 Topic 暂存到消息属性中，把投递的 Topic 改成 rmq_sys_wheel_timer。

随后等待服务线程扫描这个定时 Topic 中的消息，放入时间轮，开始定时。

为了避免瞬时保存的定时消息过多，所以采用了生产-消费模式，将保存的过程分为扫描和入轮两个步骤。

##### TimerEnqueueGetService 扫描定时消息

这个线程通过遍历消费队列索引的方式不断扫描定时消息 Topic 中新的定时消息。

扫描到了之后将消息从CommitLog中查出来，封装成 TimerRequest，放入有界阻塞队列 enqueuePutQueue。如果队列满，则会无限次重试等待，达到流控效果。

关键代码：

```java
/**
 * 从 commitLog 读取指定主题（TIMER_TOPIC）的定时消息，放入 enqueuePutQueue
 *
 * @param queueId 定时消息主题队列 ID，默认为 0（定时消息主题只有一个队列）
 * @return 是否取到消息
 */
public boolean enqueue(int queueId) {
    if (storeConfig.isTimerStopEnqueue()) {
        return false;
    }
    if (!isRunningEnqueue()) {
        return false;
    }
    // 获取定时消息主题的消费队列
    ConsumeQueueInterface cq = this.messageStore.getConsumeQueue(TIMER_TOPIC, queueId);
    if (null == cq) {
        return false;
    }
    // 更新当前读取的队列偏移量
    if (currQueueOffset < cq.getMinOffsetInQueue()) {
        LOGGER.warn("Timer currQueueOffset:{} is smaller than minOffsetInQueue:{}",
            currQueueOffset, cq.getMinOffsetInQueue());
        currQueueOffset = cq.getMinOffsetInQueue();
    }
    long offset = currQueueOffset;
    ReferredIterator<CqUnit> iterator = null;
    try {
        iterator = cq.iterateFrom(offset);
        if (null == iterator) {
            return false;
        }

        int i = 0;
        // 遍历消费队列中的索引，查询消息，封装成 TimerRequest，放入 enqueuePutQueue
        while (iterator.hasNext()) {
            i++;
            perfCounterTicks.startTick("enqueue_get");
            try {
                CqUnit cqUnit = iterator.next();
                long offsetPy = cqUnit.getPos();
                int sizePy = cqUnit.getSize();
                cqUnit.getTagsCode(); //tags code
                MessageExt msgExt = getMessageByCommitOffset(offsetPy, sizePy);
                if (null == msgExt) {
                    perfCounterTicks.getCounter("enqueue_get_miss");
                } else {
                    lastEnqueueButExpiredTime = System.currentTimeMillis();
                    lastEnqueueButExpiredStoreTime = msgExt.getStoreTimestamp();
                    long delayedTime = Long.parseLong(msgExt.getProperty(TIMER_OUT_MS));
                    // use CQ offset, not offset in Message
                    msgExt.setQueueOffset(offset + i);
                    TimerRequest timerRequest = new TimerRequest(offsetPy, sizePy, delayedTime, System.currentTimeMillis(), MAGIC_DEFAULT, msgExt);
                    // System.out.printf("build enqueue request, %s%n", timerRequest);
                    while (!enqueuePutQueue.offer(timerRequest, 3, TimeUnit.SECONDS)) {
                        if (!isRunningEnqueue()) {
                            return false;
                        }
                    }
                    Attributes attributes = DefaultStoreMetricsManager.newAttributesBuilder()
                            .put(DefaultStoreMetricsConstant.LABEL_TOPIC, msgExt.getProperty(MessageConst.PROPERTY_REAL_TOPIC)).build();
                    DefaultStoreMetricsManager.timerMessageSetLatency.record((delayedTime - msgExt.getBornTimestamp()) / 1000, attributes);
                }
            } catch (Exception e) {
                // here may cause the message loss
                if (storeConfig.isTimerSkipUnknownError()) {
                    LOGGER.warn("Unknown error in skipped in enqueuing", e);
                } else {
                    holdMomentForUnknownError();
                    throw e;
                }
            } finally {
                perfCounterTicks.endTick("enqueue_get");
            }
            // if broker role changes, ignore last enqueue
            if (!isRunningEnqueue()) {
                return false;
            }
            currQueueOffset = offset + i;
        }
        currQueueOffset = offset + i;
        return i > 0;
    } catch (Exception e) {
        LOGGER.error("Unknown exception in enqueuing", e);
    } finally {
        if (iterator != null) {
            iterator.release();
        }
    }
    return false;
}
```



##### TimerEnqueuePutService 将定时消息放入时间轮和TimeLog

该线程不断扫描enqueuePutQueue，取出TimeRequest，并批量放入TimeLog，再放入时间轮槽位。

如果定时时间小于当前写TimeLog的时间，就说明消息已经到期，直接加入到dequeuePutQueue，等待投递到CommitLog。

如果定时消息时长大于两天，则需要轮转。

关键代码：

```java
protected List<TimerRequest> fetchTimerRequests() throws InterruptedException {
    List<TimerRequest> trs = null;
    TimerRequest firstReq = enqueuePutQueue.poll(10, TimeUnit.MILLISECONDS);
    if (null != firstReq) {
        trs = new ArrayList<>(16);
        trs.add(firstReq);
        while (true) {
            TimerRequest tmpReq = enqueuePutQueue.poll(3, TimeUnit.MILLISECONDS);
            if (null == tmpReq) {
                break;
            }
            trs.add(tmpReq);
            if (trs.size() > 10) {
                break;
            }
        }
    }
    return trs;
}

protected void putMessageToTimerWheel(TimerRequest req) {
    try {
        perfCounterTicks.startTick(ENQUEUE_PUT);
        DefaultStoreMetricsManager.incTimerEnqueueCount(getRealTopic(req.getMsg()));
        if (shouldRunningDequeue && req.getDelayTime() < currWriteTimeMs) {
            // 如果定时时间小于当前写 TimerLog 的时间，说明消息已经到期
            // 直接加入到 dequeuePutQueue，准备投递到 CommitLog
            req.setEnqueueTime(Long.MAX_VALUE);
            dequeuePutQueue.put(req);
        } else {
            // 将 TimerRequest 加入 TimerLog 和时间轮
            boolean doEnqueueRes = doEnqueue(
                req.getOffsetPy(), req.getSizePy(), req.getDelayTime(), req.getMsg());
            req.idempotentRelease(doEnqueueRes || storeConfig.isTimerSkipUnknownError());
        }
        perfCounterTicks.endTick(ENQUEUE_PUT);
    } catch (Throwable t) {
        LOGGER.error("Unknown error", t);
        if (storeConfig.isTimerSkipUnknownError()) {
            req.idempotentRelease(true);
        } else {
            holdMomentForUnknownError();
        }
    }
}

protected void fetchAndPutTimerRequest() throws Exception {
    long tmpCommitQueueOffset = currQueueOffset;
    List<TimerRequest> trs = this.fetchTimerRequests();
    if (CollectionUtils.isEmpty(trs)) {
        commitQueueOffset = tmpCommitQueueOffset;
        maybeMoveWriteTime();
        return;
    }

    while (!isStopped()) {
        // 将 TimerRequest 中的消息写入到 TimerLog 中
        CountDownLatch latch = new CountDownLatch(trs.size());
        for (TimerRequest req : trs) {
            req.setLatch(latch);
            this.putMessageToTimerWheel(req);
        }
        // 检查和等待 CountDownLatch
        checkDequeueLatch(latch, -1);
        boolean allSuccess = trs.stream().allMatch(TimerRequest::isSucc);
        if (allSuccess) {
            // 全部写入成功
            break;
        } else {
            // 有写入失败，等待 0.05s
            holdMomentForUnknownError();
        }
    }
    // 更新 commitQueueOffset 和 currWriteTimeMs
    commitQueueOffset = trs.get(trs.size() - 1).getMsg().getQueueOffset();
    maybeMoveWriteTime();
}

/**
 * 从 enqueuePutQueue 中取出定时消息，放入 timerWheel
 */
public boolean doEnqueue(long offsetPy, int sizePy, long delayedTime, MessageExt messageExt) {
    LOGGER.debug("Do enqueue [{}] [{}]", new Timestamp(delayedTime), messageExt);
    //copy the value first, avoid concurrent problem
    long tmpWriteTimeMs = currWriteTimeMs;
    boolean needRoll = delayedTime - tmpWriteTimeMs >= (long) timerRollWindowSlots * precisionMs;
    int magic = MAGIC_DEFAULT;
    // 判断定时消息是否需要轮转。判断依据为：定时消息是不是近 2 天内要投递，不是则需要轮转
    if (needRoll) {
        magic = magic | MAGIC_ROLL;
        if (delayedTime - tmpWriteTimeMs - (long) timerRollWindowSlots * precisionMs < (long) timerRollWindowSlots / 3 * precisionMs) {
            //give enough time to next roll
            delayedTime = tmpWriteTimeMs + (long) (timerRollWindowSlots / 2) * precisionMs;
        } else {
            delayedTime = tmpWriteTimeMs + (long) timerRollWindowSlots * precisionMs;
        }
    }
    // 是否是取消定时消息
    boolean isDelete = messageExt.getProperty(TIMER_DELETE_UNIQUE_KEY) != null;
    if (isDelete) {
        magic = magic | MAGIC_DELETE;
    }
    String realTopic = messageExt.getProperty(MessageConst.PROPERTY_REAL_TOPIC);
    // 获取定时消息对应的时间轮槽
    Slot slot = timerWheel.getSlot(delayedTime);
    ByteBuffer tmpBuffer = timerLogBuffer;
    tmpBuffer.clear();
    tmpBuffer.putInt(TimerLog.UNIT_SIZE); //size
    tmpBuffer.putLong(slot.lastPos); //prev pos
    tmpBuffer.putInt(magic); //magic
    tmpBuffer.putLong(tmpWriteTimeMs); //currWriteTime
    tmpBuffer.putInt((int) (delayedTime - tmpWriteTimeMs)); //delayTime
    tmpBuffer.putLong(offsetPy); //offset
    tmpBuffer.putInt(sizePy); //size
    tmpBuffer.putInt(hashTopicForMetrics(realTopic)); //hashcode of real topic
    tmpBuffer.putLong(0); //reserved value, just set to 0 now
    long ret = timerLog.append(tmpBuffer.array(), 0, TimerLog.UNIT_SIZE);
    if (-1 != ret) {
        // 写入 TimerLog 成功，将写入 TimerLog 的消息加入时间轮
        // If it's a delete message, then slot's total num -1
        // TODO: check if the delete msg is in the same slot with "the msg to be deleted".
        timerWheel.putSlot(delayedTime, slot.firstPos == -1 ? ret : slot.firstPos, ret,
            isDelete ? slot.num - 1 : slot.num + 1, slot.magic);
        addMetric(messageExt, isDelete ? -1 : 1);
    }
    return -1 != ret;
}
```



#### 定时消息投递

定时消息投递被分为三个任务：

1. 从时间轮中扫描到期的定时消息（偏移量）
2. 根据定时消息偏移量，到 CommitLog 中查询完整的消息体
3. 将查到的消息投递到 CommitLog 的目标 Topic

##### TimerDequeueGetService扫描时间轮中到期的消息

这个线程的作用是：推进时间轮，将时间轮槽位对应的定时消息请求从时间轮和TimerLog中取出，加入到 dequeueGetQueue 中。

- 每 0.1s 执行一次，根据当前扫描时间轮的时间戳，从时间轮和 TimerLog 中查询出 TimerRequest，并分成定时请求和定时消息取消请求两类。
- 先批量将取消请求入队，等待处理完毕，再将定时消息请求入队，等待处理完毕。
- 该槽位的定时消息都处理完成后，推进时间轮扫描时间到下一槽位。

关键代码：

```java
/**
 * 获取时间轮中一个槽位中对应的TimeLog定时消息请求列表，放入 dequeueGetQueue中处理
 * @return 0：当前读取的时间轮槽为空 no message，1：处理成功，2：处理失败
 *
 */
public int dequeue() throws Exception {
    if (storeConfig.isTimerStopDequeue()) {
        return -1;
    }
    if (!isRunningDequeue()) {
        return -1;
    }
    if (currReadTimeMs >= currWriteTimeMs) {
        return -1;
    }
    // 根据当前时间轮扫描的时间戳，获取时间轮当前槽
    Slot slot = timerWheel.getSlot(currReadTimeMs);
    if (-1 == slot.timeMs) {
        // 如果当前槽为空，推进时间轮并返回
        moveReadTime();
        return 0;
    }
    try {
        //clear the flag
        dequeueStatusChangeFlag = false;

        // 获取 TimerLog 中的物理偏移量
        long currOffsetPy = slot.lastPos;
        Set<String> deleteUniqKeys = new ConcurrentSkipListSet<>();
        // 普通定时消息请求栈
        LinkedList<TimerRequest> normalMsgStack = new LinkedList<>();
        // 定时消息取消请求栈
        LinkedList<TimerRequest> deleteMsgStack = new LinkedList<>();
        // TimerLog Buffer 队列
        LinkedList<SelectMappedBufferResult> sbrs = new LinkedList<>();
        SelectMappedBufferResult timeSbr = null;
        // 从 TimerLog 链表中一个一个读取索引项，放入请求栈
        //read the timer log one by one
        while (currOffsetPy != -1) {
            perfCounterTicks.startTick("dequeue_read_timerlog");
            if (null == timeSbr || timeSbr.getStartOffset() > currOffsetPy) {
                timeSbr = timerLog.getWholeBuffer(currOffsetPy);
                if (null != timeSbr) {
                    sbrs.add(timeSbr);
                }
            }
            if (null == timeSbr) {
                break;
            }
            long prevPos = -1;
            try {
                int position = (int) (currOffsetPy % timerLogFileSize);
                timeSbr.getByteBuffer().position(position);
                timeSbr.getByteBuffer().getInt(); //size
                prevPos = timeSbr.getByteBuffer().getLong();
                int magic = timeSbr.getByteBuffer().getInt();
                long enqueueTime = timeSbr.getByteBuffer().getLong();
                long delayedTime = timeSbr.getByteBuffer().getInt() + enqueueTime;
                long offsetPy = timeSbr.getByteBuffer().getLong();
                int sizePy = timeSbr.getByteBuffer().getInt();
                TimerRequest timerRequest = new TimerRequest(offsetPy, sizePy, delayedTime, enqueueTime, magic);
                timerRequest.setDeleteList(deleteUniqKeys);
                if (needDelete(magic) && !needRoll(magic)) {
                    deleteMsgStack.add(timerRequest);
                } else {
                    normalMsgStack.addFirst(timerRequest);
                }
            } catch (Exception e) {
                LOGGER.error("Error in dequeue_read_timerlog", e);
            } finally {
                currOffsetPy = prevPos;
                perfCounterTicks.endTick("dequeue_read_timerlog");
            }
        }
        if (deleteMsgStack.size() == 0 && normalMsgStack.size() == 0) {
            LOGGER.warn("dequeue time:{} but read nothing from timerLog", currReadTimeMs);
        }
        for (SelectMappedBufferResult sbr : sbrs) {
            if (null != sbr) {
                sbr.release();
            }
        }
        if (!isRunningDequeue()) {
            return -1;
        }
        // 分批将定时消息删除请求放入 dequeueGetQueue 去处理
        CountDownLatch deleteLatch = new CountDownLatch(deleteMsgStack.size());
        //read the delete msg: the msg used to mark another msg is deleted
        for (List<TimerRequest> deleteList : splitIntoLists(deleteMsgStack)) {
            for (TimerRequest tr : deleteList) {
                tr.setLatch(deleteLatch);
            }
            dequeueGetQueue.put(deleteList);
        }
        // 等待定时消息删除请求处理（放入 dequeuePutQueue）
        //do we need to use loop with tryAcquire
        checkDequeueLatch(deleteLatch, currReadTimeMs);

        // 分批将定时消息请求放入 dequeueGetQueue 去处理
        CountDownLatch normalLatch = new CountDownLatch(normalMsgStack.size());
        //read the normal msg
        for (List<TimerRequest> normalList : splitIntoLists(normalMsgStack)) {
            for (TimerRequest tr : normalList) {
                tr.setLatch(normalLatch);
            }
            dequeueGetQueue.put(normalList);
        }
        checkDequeueLatch(normalLatch, currReadTimeMs);
        // if master -> slave -> master, then the read time move forward, and messages will be lossed
        if (dequeueStatusChangeFlag) {
            return -1;
        }
        if (!isRunningDequeue()) {
            return -1;
        }
        // 推进时间轮
        moveReadTime();
    } catch (Throwable t) {
        LOGGER.error("Unknown error in dequeue process", t);
        if (storeConfig.isTimerSkipUnknownError()) {
            moveReadTime();
        }
    }
    return 1;
}
```

##### TimerDequeueGetMessageService 查询原始消息

这个线程的作用是：处理 dequeueGetQueue 中的 TimerRequest，根据索引在 CommitLog 中查出原始消息，放到 dequeuePutQueue。

- 从 dequeueGetQueue 中取出 TimerRequest
- 对取出的 TimerRequst，从 CommitLog 中查询原始消息
- 处理定时消息取消请求，查询出原始消息中要取消消息的 UNIQ_KEY，放入 deleteUniqKeys Set
- 处理普通定时消息请求
  - 如果 DeleteUniqKeys 中包含这个消息，则什么都不做（取消投递）
  - 否则将查出的原始消息放入 TimerRequest，然后将 TimerRequest 放入 dequeuePutQueue，准备投递到 CommitLog

关键代码：

```java
@Override
public void run() {
    setState(AbstractStateService.START);
    TimerMessageStore.LOGGER.info(this.getServiceName() + " service start");
    while (!this.isStopped()) {
        try {
            setState(AbstractStateService.WAITING);
            List<TimerRequest> trs = dequeueGetQueue.poll(100L * precisionMs / 1000, TimeUnit.MILLISECONDS);
            if (null == trs || trs.size() == 0) {
                continue;
            }
            setState(AbstractStateService.RUNNING);
            for (int i = 0; i < trs.size(); ) {
                TimerRequest tr = trs.get(i);
                boolean doRes = false;
                try {
                    long start = System.currentTimeMillis();
                    MessageExt msgExt = getMessageByCommitOffset(tr.getOffsetPy(), tr.getSizePy());
                    if (null != msgExt) {
                        if (needDelete(tr.getMagic()) && !needRoll(tr.getMagic())) {
                            if (msgExt.getProperty(MessageConst.PROPERTY_TIMER_DEL_UNIQKEY) != null && tr.getDeleteList() != null) {
                                //Execute metric plus one for messages that fail to be deleted
                                addMetric(msgExt, 1);
                                tr.getDeleteList().add(msgExt.getProperty(MessageConst.PROPERTY_TIMER_DEL_UNIQKEY));
                            }
                            tr.idempotentRelease();
                            doRes = true;
                        } else {
                            String uniqueKey = MessageClientIDSetter.getUniqID(msgExt);
                            if (null == uniqueKey) {
                                LOGGER.warn("No uniqueKey for msg:{}", msgExt);
                            }
                            if (null != uniqueKey && tr.getDeleteList() != null && tr.getDeleteList().size() > 0 && tr.getDeleteList().contains(uniqueKey)) {
                                //Normally, it cancels out with the +1 above
                                addMetric(msgExt, -1);
                                doRes = true;
                                tr.idempotentRelease();
                                perfCounterTicks.getCounter("dequeue_delete").flow(1);
                            } else {
                                tr.setMsg(msgExt);
                                while (!isStopped() && !doRes) {
                                    doRes = dequeuePutQueue.offer(tr, 3, TimeUnit.SECONDS);
                                }
                            }
                        }
                        perfCounterTicks.getCounter("dequeue_get_msg").flow(System.currentTimeMillis() - start);
                    } else {
                        //the tr will never be processed afterwards, so idempotentRelease it
                        tr.idempotentRelease();
                        doRes = true;
                        perfCounterTicks.getCounter("dequeue_get_msg_miss").flow(System.currentTimeMillis() - start);
                    }
                } catch (Throwable e) {
                    LOGGER.error("Unknown exception", e);
                    if (storeConfig.isTimerSkipUnknownError()) {
                        tr.idempotentRelease();
                        doRes = true;
                    } else {
                        holdMomentForUnknownError();
                    }
                } finally {
                    if (doRes) {
                        i++;
                    }
                }
            }
            trs.clear();
        } catch (Throwable e) {
            TimerMessageStore.LOGGER.error("Error occurred in " + getServiceName(), e);
        }
    }
    TimerMessageStore.LOGGER.info(this.getServiceName() + " service end");
    setState(AbstractStateService.END);
}
```

##### TimerDequeuePutMessageService 投递定时消息

这个线程的作用是：将消息从 dequeuePutQueue 中取出，若已经到期，投递到 CommitLog 中

- 无限循环从 dequeuePutQueue 中取出 TimerRequest
- 将原始消息的 Topic 和 queueId 从消息属性中取出，用它们构造成一个新的消息
- 将消息投递到 CommitLog
- 如果投递失败，则需要等待 精度/2 时间然后重新投递，必须保证消息投递成功。

关键代码：

```java
@Override
public void run() {
    setState(AbstractStateService.START);
    TimerMessageStore.LOGGER.info(this.getServiceName() + " service start");
    while (!this.isStopped() || dequeuePutQueue.size() != 0) {
        try {
            setState(AbstractStateService.WAITING);
            // 取出到期的 TimerRequest
            TimerRequest tr = dequeuePutQueue.poll(10, TimeUnit.MILLISECONDS);
            if (null == tr) {
                continue;
            }
            setState(AbstractStateService.RUNNING);
            boolean doRes = false;
            boolean tmpDequeueChangeFlag = false;
            try {
                while (!isStopped() && !doRes) {
                    if (!isRunningDequeue()) {
                        dequeueStatusChangeFlag = true;
                        tmpDequeueChangeFlag = true;
                        break;
                    }
                    try {
                        perfCounterTicks.startTick(DEQUEUE_PUT);
                        MessageExt msgExt = tr.getMsg();
                        DefaultStoreMetricsManager.incTimerDequeueCount(getRealTopic(msgExt));
                        if (tr.getEnqueueTime() == Long.MAX_VALUE) {
                            // never enqueue, mark it.
                            MessageAccessor.putProperty(msgExt, TIMER_ENQUEUE_MS, String.valueOf(Long.MAX_VALUE));
                        }
                        addMetric(msgExt, -1);
                        // 将原始定时消息的 Topic 和 QueueId 等信息复原，构造一个新的消息
                        MessageExtBrokerInner msg = convert(msgExt, tr.getEnqueueTime(), needRoll(tr.getMagic()));
                        doRes = PUT_NEED_RETRY != doPut(msg, needRoll(tr.getMagic()));
                        while (!doRes && !isStopped()) {
                            // 如果投递失败需要重试，等待{精确度 / 2}时间然后重新投递
                            if (!isRunningDequeue()) {
                                dequeueStatusChangeFlag = true;
                                tmpDequeueChangeFlag = true;
                                break;
                            }
                            doRes = PUT_NEED_RETRY != doPut(msg, needRoll(tr.getMagic()));
                            Thread.sleep(500L * precisionMs / 1000);
                        }
                        perfCounterTicks.endTick(DEQUEUE_PUT);
                    } catch (Throwable t) {
                        LOGGER.info("Unknown error", t);
                        if (storeConfig.isTimerSkipUnknownError()) {
                            doRes = true;
                        } else {
                            holdMomentForUnknownError();
                        }
                    }
                }
            } finally {
                tr.idempotentRelease(!tmpDequeueChangeFlag);
            }

        } catch (Throwable e) {
            TimerMessageStore.LOGGER.error("Error occurred in " + getServiceName(), e);
        }
    }
    TimerMessageStore.LOGGER.info(this.getServiceName() + " service end");
    setState(AbstractStateService.END);
}
```

## 参考

- [RIP-43 Support timing messages with arbitrary time delay.](https://docs.google.com/document/d/1D6XWwY39p531c2aVi5HQll9iwzTUNT1haUFHqMoRkT0/edit#heading=h.d7x9otgla1zw)
- [Rocketmq 5.0 任意时间定时消息（RIP-43） 原理详解 & 源码解析](https://hscarb.github.io/rocketmq/20230808-rocketmq-timer.html)

## **结论**

RocketMQ的新定时任务方案通过引入TimeLog和TimeWheel，提供了灵活且精确的定时消息调度能力。这项改进显著增强了RocketMQ在复杂应用环境下的鲁棒性和适应性。对于开发者来说，这是一个巨大的跃进，使得在更高效的平台上开发和实施实时任务成为可能。

## **常见问题解答**

1. **我能在RocketMQ中设置超过3天的定时消息吗？** 是的，新方案支持更长时间的定时消息，依赖于时间轮的灵活性。
2. **新方案如何处理大量同时产生的定时消息？** 通过生产-消费模式的流控机制，高效地管理消息队列的读取和入队。
3. **为什么需要使用TimeLog和TimeWheel？** TimeLog用于记录消息的状态和时间，TimeWheel则提供高效的时间调度，二者协同支持毫秒级定时任务。
4. **如何保证消息的精准投递？** 在投递阶段，若出现投递失败，系统会等待并重试，确保无丢失。
5. **原有的定时方案还可用吗？** 旧方案在某些简单场景下仍能工作，但新方案的精度和可靠性更高。
