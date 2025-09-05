---
title: MySQL参数调优-天池全球数据库大赛初赛
date: '2024-10-16'
lastmod: '2024-10-20'
tags: ['参数调优', 'MySQL', '数据库']
draft: false
summary: '云计算为数据库的架构发展开辟了新的技术路径，与传统数据库相比，云原生数据库能够充分利用云计算潜力，最大的技术变革是资源池化与资源解耦，以及由此而来的弹性、高可用、智能化运维等核心能力。本届大赛聚焦TPC-C Benchmark基准测试及相关业务场景，旨在鼓励参赛者通过创新的优化方法，充分挖掘数据库系统软硬件潜力，提升TPC-C基准测试场景下的性能表现。'
authors: ['default']
---

## 背景

> 选手需要使用特定版本MySQL作为基础代码并各自独立实现性能优化，最终在统一设定的环境中运行TPC-C基准测试，根据测试中每分钟事务完成数tpmC记分排名。
>
> 竞赛采用搭载第五代英特尔® 至强®可扩展处理器的第八代阿里云ECS(g8i) 8C 32GB机型作为统一测评平台;
>
> 采用英特尔®oneAPI作为统一编译环境;
>
> 采用MySQL Community Server 8.4.0作为基础代码;
>
> 采用benchmarkSQL作为TPCC基准测试程序。
>
> 另外，初赛不涉及ACID检查，不涉及数据库的多次启停

初赛总的来说，就是使用benchmarksql对赛题方提供的一个编译好了的二进制Mysql进行压测，然后比较tpmC分数排名。这个镜像不是公开的，拉不下来，所以只能”虚空“调my.cnf中的启动参数，进行参数调优。

所以，主要的工作就是

- 调整my.cnf中的启动参数
- 调整WAREHOUSE数量，这个是tpm-C模型中的仓库数量，决定了货物数量和最终的事务完成数量。

提交压测后，容器中会根据启动参数启动mysql，然后使用benchmarksql压测。因此借此机会，了解下mysql中各个参数的作用。

## 先随便调一调

| 参数                           | 值   | 作用                                                         |
| ------------------------------ | ---- | ------------------------------------------------------------ |
| max_connections                | 4000 | 允许同时连接到MySQL服务器的最大客户端数量。作用：控制并发连接数,防止服务器过载。设置较高可支持更多并发连接,但也会消耗更多资源 |
| innodb_buffer_pool_size        | 18G  | InnoDB存储引擎的缓冲池大小。作用:缓存表和索引数据,加快查询速度。通常设置为服务器物理内存的50%-80% |
| innodb_flush_log_at_trx_commit | 2    | 含义:控制InnoDB日志刷新到磁盘的频率。作用:值为2时,每次事务提交时写入日志,但每秒才刷新到磁盘 |
| innodb_log_file_size           | 1G   | InnoDB重做日志文件的大小。作用:更大的日志文件可以减少磁盘I/O,提高性能,但会增加崩溃恢复时间 |
| innodb_log_buffer_size         | 16M  | InnoDB用来缓冲日志数据的内存大小。作用:较大的缓冲区可以减少磁盘I/O,特别是对于大事务很有帮助 |
| innodb_buffer_pool_instances   | 8    | 将InnoDB缓冲池分割成的实例数量。作用:多个实例可以减少内部竞争,提高并发性能,特别是在多核系统上，一般设置为设置为CPU核心数的1-2倍 |
| sync_binlog                    | 0    | 控制二进制日志同步到磁盘的频率。作用:0表示由操作系统决定何时同步,可以提高性能但可能在崩溃时丢失事务 |
| innodb_stats_on_metadata       | OFF  | 控制InnoDB是否在元数据操作时更新统计信息。作用:关闭可以减少I/O操作,提高性能,特别是对于频繁的表打开操作 |
| innodb_file_per_table          | on   | 是否为每个InnoDB表使用单独的表空间文件。作用:开启可以使每个表有自己的文件,便于管理和优化,也可以在删除表时立即释放磁盘空间 |
| warehouse                      | 8    |                                                              |

实际参数日志：

![image-20241016152615508](https://images.txlink.top/202410/images/image-20241016152615508.png)

后面应该就是调这些就可以。

### 结果

分数:3858.0000

tpmc:23056.2115

warehouse:300.0000

tpmcPerWarehouse:76.8540

## 再调调参，还在发散~

先之前的测试中，当增加warehouse后，发现数据导入时无法全部导入成功，由于评测系统有限时。

> 测评分为三个阶段:
>
> - 数据库初始化阶段: 限时5分钟，测评程序将依次调用选手提交的`create_new_db.sh`与`start_db.sh`，之后待数据库启动提供服务后完成数据库创建和压测账号创建
> - 数据导入阶段 : 限时30分钟，因选手调优的数据库性能差异和WAREHOUSE数不同，数据导入速度和时间不尽相同。选手需要控制在指定的时间内完成数据导入
> - 基准测试阶段 : 固定运行10分钟

所以，基本上以提高数据插入速度为目标进行参数调优就行。

提高写入速度-->提高30分钟内导入数据量-->增加warehouse数量

最终的有效分数也跟warehouse数量息息相关

> - 在4-1标准中规定了每WAREHOUSE的tpmC最低为9，最高为12.86，
>
>   选手可通过根目录下WAREHOUSE文件修改测试使用的WAREHOUSE数
>
>   - tpmcPerWarehouse高于12.86时，取warehouses * 12.86作为有效分数
>   - tpmcPerWarehouse低于9时，不作为有效成绩，即score为0

于是，参数变成了这样：

```
max_connections=7000
innodb_buffer_pool_size = 22G
innodb_flush_log_at_trx_commit = 0
innodb_flush_method = O_DIRECT_NO_FSYNC
innodb_log_file_size = 2G
innodb_log_buffer_size=64M
innodb_log_files_in_group=3
innodb_buffer_pool_instances=8
innodb_write_io_threads=16
sync_binlog = 0
innodb_stats_on_metadata = OFF
innodb_file_per_table=on
innodb_io_capacity=3000
innodb_io_capacity_max=20000
max_binlog_cache_size=1G
table_open_cache=8000
innodb_max_dirty_pages_pct=75.000000
innodb_page_cleaners=8
skip-log-bin
innodb_doublewrite = 0
warehouse=410  //现在的写入速度理论上能设置到450以上的，没次数了。。。
```

看日志写入速度从5000提高到了8000

### 结果

分数:5272.6000

tpmc:27026.4708

warehouse:410.0000

tpmcPerWarehouse:65.9182
