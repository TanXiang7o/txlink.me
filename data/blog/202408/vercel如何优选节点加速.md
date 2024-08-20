---
title: vercel如何优选节点加速
date: '2024-08-18'
tags: ['vercel', '部署']
draft: false
summary: '一般博客加速会使用Cloudflare提供的免费CDN, 但是还是得折腾，对于新手和不想折腾的朋友来说还是有一点点繁琐'
authors: ['default']
---

具体部署方式参考这个项目：https://github.com/xingpingcn/enhanced-FaaS-in-China
## 前提
- 有一个域名，不需要备案
- 在vercel上部署完成博客

## 步骤
1. 在vercel => settings => domains 中添加两个域名, 假如说你的域名是`example.com`, 那么添加`example.com`和`www.example.com`。其中`example.com`308重定向到`www.example.com`，然后添加A记录和CName到你的域名解析商，分别指向`76.76.21.21`和`cname.vercel-dns.com`。
2. 稍等一会即可通过域名访问你的项目，但是这个时候还没有加速。
3. 修改把CName指向`vercel-cname.xingpingcn.top`即可完成加速。
4. 其它部署平台参考这个项目。

## 测试
未加速：
![img](/static/images/202408/2c20bd11-a368-496a-91a4-efe7e47e41f7.png)

加速后：
![img](/static/images/202408/a4609253-141e-44e9-9ce9-4ea698ef760f.png)

貌似也就一般😂，没有项目里说的那么快，估计是用的人变多了