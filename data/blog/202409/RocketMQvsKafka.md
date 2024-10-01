---
title: RocketMQ vs Kafka
date: '2024-09-01'
lastmod: '2024-09-15'
tags: ["RocketMQ", "Kafka", "消息队列", "大数据", "线上业务"]
draft: false
summary: '探索RocketMQ和Kafka之间的差异，找到适合在线业务和大数据应用的最佳消息队列。'
authors: ['default']
---

# RocketMQ vs Kafka

---

## RocketMQ

RocketMQ是阿里巴巴在2012年开源的消息队列产品，后来捐赠给Apache软件基金会，2017年正式毕业，称为Apache的顶级项目。RocketMQ的官网地址：https://rocketmq.apache.org/。

RocketMQ使用Java语言编写，它有非常活跃的中文社区，你遇到的大多数问题都可以找到中文的答案。

RocketMQ对在线业务的响应时延做了大量优化，大多数情况下可以做到毫秒级响应，如果我们的应用场景中时延响应非常重要，那么可以选择RocketMQ。

RocketMQ的性能要比RabbitMQ高一个数量级，每秒钟可以处理几十万条消息。

RocketMQ的一个劣势是它在国外没有那么流行，与周边生态系统集成和兼容稍微差一些。

官网上将RocketMQ和Kafka做了对比，RocketMQ除了终端还支持**dashboard**观测核心指标，kafka只支持终端。且**RocketMQ支持消息轨迹、消息优先级、广播消息、服务端触发的重试、延迟消息、JMS、OpenMessaging协议等，而kafka不支持。**

## Kafka

Kafka最早由LinkedIn开发，目前也是Apache的顶级项目，官网地址：https://kafka.apache.org/。

Kafka目前已经是一个非常成熟的消息队列产品，无论是在数据可靠性、稳定性还是功能特性等方面都可以满足绝大多数场景的需求。

**Kafka使用Scala和Java语言开发，设计上大量使用了批量和异步的思想**，这样可以让Kafka做到高性能，Kafka的性能，特别是异步收发的性能，是这三款消息队列产品中最好的。它在性能上和RocketMQ没有数量级上的差别，每秒钟可以处理几十万条消息。

**Kafka与周边生态系统的兼容性是最好的没有之一，尤其是在大数据和流计算领域，几乎所有的相关开源软件都会优先选择支持Kafka。**

Kafka存在的问题是同步收发消息的响应时延比较高，当客户端发送一条消息时，Kafka并不会立即发送出去，而是要等一会儿攒在一批再统一发送，在它的Broker中很多地方还存在“**攒一波再处理**”的设计，当我们的业务场景中每秒钟的消息数量没有那么多时，Kafka的时延反而会比较高，因此，**Kafka不太适合在线业务场景**。

## 架构做‘减法’

Kafka使用Zookeeper做注册中心，进行集群管理。但是Zookeeper还有很多别的功能，比如说分布式锁、配置管理等场景，因此显得太重（后来支持了Raft模式）。

相比Kafka，RocketMQ在架构上将Zookeeper换成了轻量的nameserver，其只有服务注册和路由管理的功能。

## 分区简化

Kafka会将topic拆分成多个partition分区，用来提升并发性。

在RocketMQ中，topic也会被拆分到多个queue，queue中不存储消息的完整数据，只存储offset偏移量等信息，而完整数据存储到Commitlog文件中。

因此，RocketMQ在读取消息时，需要先读取偏移量，再从Commitlog文件中读取完整消息。

## 底层存储

Kafka会将topic进行partition分区，每个partition又分成多个segment文件。当对多个topic进行写操作时，对多个segment 的顺序写可能会劣化为随机写，而随机写相比顺序写要慢几十倍。

RocketMQ中简化了底层存储，对于所有topic的所有消息，全部存在一个CommitLog文件中，在同时写多个topic时，仍然是顺序写。CommitLog以偏移量命名，默认是1g大小，超过1g就会重新写一个新文件。

## Kafka为什么性能更好？

消息队列中的消息，在发送到broker中，就会进行同步或者异步刷盘。在消费时，需要将消息从磁盘发送到网卡。

操作系统分为用户空间和内核空间，用户想要将数据从磁盘发送到网卡，就会发生下面几件事：

1. 程序发起系统调用read，将磁盘数据拷贝到内核空间中的缓冲区中，再从内核空间的缓冲区拷贝到用户空间。
2. 程序再次发起系统调用write，将数据从用户空间拷贝到socket缓冲区，再从socket缓冲区拷贝到网卡。

整个过程，本机内发生了两次系统调用，4次上下文切换，4次数据拷贝。总体过程效率比较低。

而零拷贝就是为了减少该过程耗费的时间，常见的方案一般就是mmap和sendfile。

### mmap是什么

mmap是操作系统内核提供的方法。程序发起系统调用mmap将磁盘数据拷贝到内核空间的缓冲区，内核空间的缓冲区映射到用户空间，这里少了一次拷贝。然后再write。。。同上。整个过程少了一次拷贝。

### sendfile是什么

sendfile也是内核提供的一个方法，程序发起系统调用sendfile将磁盘数据拷贝到内核缓冲区，然后直接呗拷贝到网卡。整个过程只发生了一次系统调用，两次上下文切换，两次数据拷贝。因此，sendfile的性能要比mmap要好。

### 为什么RocketMQ不用sendfile？

由于使用sendfile时数据直接被拷贝到网卡中，用户是看不到的，因此也不能对数据进行一些额外处理。而RocketMQ的一些功能需要了解具体的消息内容，比如说消息失败的消息重新投递到死信队列中。

### 参考：

https://www.cnblogs.com/wing011203/p/17182477.html

https://rocketmq.apache.org/zh/docs/

---

## 结论

RocketMQ和Kafka各有优劣，选择哪一个取决于具体的业务需求。如果你的业务需要毫秒级的响应时延，建议选择RocketMQ。如果你需要与大数据和流计算系统有良好的兼容性，Kafka是更好的选择。

## 常见问题解答

### 1. RocketMQ和Kafka的主要区别是什么？

RocketMQ和Kafka在架构、分区与存储、性能与延迟等方面有显著区别。RocketMQ响应时延较低，适合在线业务场景；Kafka异步收发性能较好，但同步收发的响应时延较高。

### 2. 哪一个更适合在线业务场景？

RocketMQ更适合在线业务场景，因为它的响应时延较低，大多数情况下可以做到毫秒级响应。

### 3. Kafka在什么场景下表现更好？

Kafka在大数据和流计算领域表现更好，几乎所有相关开源软件都会优先支持Kafka。

### 4. RocketMQ的性能如何？

RocketMQ的性能非常高，每秒钟可以处理几十万条消息，比RabbitMQ高一个数量级。

### 5. Kafka的架构为什么显得较重？

Kafka使用Zookeeper做注册中心，进行集群管理。Zookeeper还支持分布式锁、配置管理等功能，因此显得较重。
