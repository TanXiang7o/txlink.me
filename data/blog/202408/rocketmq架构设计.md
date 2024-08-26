---
title: RocketMQ 架构设计与部署详解
date: '2024-08-26'
tags: ['RocketMQ', "消息队列", "架构设计", "部署架构", "分布式系统"]
draft: false
summary: '深入解析 RocketMQ 的技术架构与部署特点，涵盖 Producer、Consumer、NameServer 和 Broker 的角色与工作流程。'
authors: ['default']

---

转载自https://github.com/apache/rocketmq/blob/develop/docs/cn/architecture.md

# **架构设计**

---

## **1 技术架构**



![rocketmq_architecture_1](/static/images/202408/rocketmq_architecture_1.png)

RocketMQ架构上主要分为四部分，如上图所示：

- Producer：消息发布的校色，支持分布式集群方式部署。Producer通过MQ的负载均衡模块选择相应的Broker集群队列进行消息投递，投递的过程支持快速失败并且低延迟。

- Consumer：消息消费的角色，支持分布式集群方式部署。支持以push推，pull拉两种模式对消息进行消费。同时也支持集群方式和广播方式的消费，它提供实时消息订阅机制，可以满足大多数用户的需求。

- NameServer：NameServer是一个非常简单的Topic路由注册中心，其角色类似于Dubbo中的zookeeper，支持Broker的动态注册和发现。主要包括两个功能：

  - Broker管理。提供心跳检测机制，检查Broker是否存活；
  - 接受Broker集群的注册信息并且保存下来作为路由信息的基本数据。每个NameServer将保存关于Broker集群的整个路由信息和用于客户端查询的队列信息。

  然后Producer和Consumer通过NameServer就可以知道整个Broker集群的路由信息，从而进行消息的投递和消费。NameServer通常也是集群的方式部署，各实例间相互不进行信息通讯。Broker是向每一台NameServer注册自己的路由信息，所以每一个NameServer实例上面都保存一份完整的路由信息。当某个NameServer因某种原因下线了，Broker仍然可以向其它NameServer同步其路由信息，Producer和Consumer仍然可以动态感知Broker的路由的信息。

- Broker：Broker主要负责消息的存储、投递和查询以及服务高可用保证，为了实现这些功能，Broker包含了以下几个重要子模块。

  1. Remoting Module：整个Broker的实体，负责处理来自Client端的请求。
  2. Client Manager：负责管理客户端(Producer/Consumer)和维护Consumer的Topic订阅信息。
  3. Store Service：提供方便简单的API接口处理消息存储到物理硬盘和查询功能。
  4. HA Service：高可用服务，提供Master Broker 和 Slave Broker之间的数据同步功能。
  5. Index Service：根据特定的Message key对投递到Broker的消息进行索引服务，以提供消息的快速查询。

![rocketmq_architecture_2](/static/images/202408/rocketmq_architecture_2.png)

## **2 部署架构**

![rocketmq_architecture_3](/static/images/202408/rocketmq_architecture_3.png)

### **RocketMQ网络部署特点**

- NameServer是一个几乎无状态节点，可集群部署，节点之间无信息交互。
- Broker部署相对复杂，Broker分为Master与Slave，一个Master可以对应多个Slave，但是一个Slave只能对应一个Master，Master与Slave 的对应关系通过指定相同的BrokerName，不同的BrokerId 来定义，BrokerId为0表示Master，非0表示Slave。Master也可以部署多个。每个Broker与NameServer集群中的所有节点建立长连接，定时注册Topic信息到所有NameServer。 注意：当前RocketMQ版本在部署架构上支持一Master多Slave，但只有BrokerId=1的从服务器才会参与消息的读负载。
- Producer与NameServer集群中的其中一个节点（随机选择）建立长连接，定期从NameServer获取Topic路由信息，并向提供Topic 服务的Master建立长连接，且定时向Master发送心跳。Producer完全无状态，可集群部署。
- Consumer与NameServer集群中的其中一个节点（随机选择）建立长连接，定期从NameServer获取Topic路由信息，并向提供Topic服务的Master、Slave建立长连接，且定时向Master、Slave发送心跳。Consumer既可以从Master订阅消息，也可以从Slave订阅消息，消费者在向Master拉取消息时，Master服务器会根据拉取偏移量与最大偏移量的距离（判断是否读老消息，产生读I/O），以及从服务器是否可读等因素建议下一次是从Master还是Slave拉取。

结合部署架构图，描述集群工作流程：

- 启动NameServer，NameServer起来后监听端口，等待Broker、Producer、Consumer连上来，相当于一个路由控制中心。
- Broker启动，跟所有的NameServer保持长连接，定时发送心跳包。心跳包中包含当前Broker信息(IP+端口等)以及存储所有Topic信息。注册成功后，NameServer集群中就有Topic跟Broker的映射关系。
- 收发消息前，先创建Topic，创建Topic时需要指定该Topic要存储在哪些Broker上，也可以在发送消息时自动创建Topic。
- Producer发送消息，启动时先跟NameServer集群中的其中一台建立长连接，并从NameServer中获取当前发送的Topic存在哪些Broker上，轮询从队列列表中选择一个队列，然后与队列所在的Broker建立长连接从而向Broker发消息。
- Consumer跟Producer类似，跟其中一台NameServer建立长连接，获取当前订阅Topic存在哪些Broker上，然后直接跟Broker建立连接通道，开始消费消息。

### **结论**

RocketMQ的架构设计和部署方式充分体现了其在分布式消息处理中强大的性能和灵活性。从Producer的消息发布，到Consumer的消息消费，再到NameServer和Broker的协作，RocketMQ提供了一套完备的解决方案，适用于各种规模的分布式系统。

### **常见问题解答**

#### **RocketMQ如何保证消息的高可用性？**

RocketMQ通过Master-Slave架构以及NameServer集群的无状态设计，确保了消息在多节点故障下仍然能够被可靠地存储和消费。

#### **如何选择适合的RocketMQ部署架构？**

根据业务需求和系统规模选择合适的部署架构。如果系统需要高可用性和高并发处理能力，可以采用多Master多Slave的部署方式。

#### **什么是RocketMQ中的路由信息？**

路由信息是指Topic与Broker的映射关系，这些信息存储在NameServer中，供Producer和Consumer在消息发送和消费时查询。

#### **RocketMQ的Master和Slave如何进行数据同步？**

RocketMQ的HA Service模块负责Master和Slave之间的数据同步，通过实时复制和定期检查，确保Slave能够快速接管Master的工作。

#### **在集群环境中，如何处理NameServer的故障？**

NameServer是无状态的，多个NameServer实例可以相互独立工作。如果某个NameServer发生故障，Producer和Consumer可以自动切换到其他可用的NameServer。