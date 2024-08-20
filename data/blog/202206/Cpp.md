---
title: C++语法
date: '2022-06-22'
tags: ['Notes', 'Cpp']
draft: false
summary: 'C++基础语法及一些新特性'
authors: ['default']
---

## static

### 类和结构体中的static

- 静态方法不能访问非静态变量
- 静态方法没有类实例
- 类中的每个 **非静态方法**都会获得当前的类实例作为参数。
- 静态成员变量必须在类外定义

## 可见性

**private**: 只有**自己的类和它的友元**才能访问（继承的子类也不行，友元的意思就是可以允许你访问这个类的私有成员）。
**protected**：这个**类以及它的所有派生类**都可以访问到这些成员。（但在main函数中new一个类就不可见，这其实是因为main**函数不是类的函数**，对main函数是不可访问的）
**public：**谁都可见。

## vector优化

1.在使用`push_back`时，如果空间不够会在其他地方申请1.5倍或者2倍的空间，然后把原来的vector里的数据拷贝到新地址。每一个数据就是一次拷贝。

```cpp
#include <iostream>
#include <vector>
using namespace std;

struct Vertex
{
    float x, y, z;

    Vertex(float x, float y, float z)
        : x(x), y(y), z(z)
    {
    }

    Vertex(const Vertex &vertex)
        : x(vertex.x), y(vertex.y), z(vertex.z)
    {
        std::cout << "Copied!" << std::endl;
    }
};

int main()
{
    std::vector<Vertex> vertices;
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(1, 2, 3));
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(4, 5, 6));
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(7, 8, 9));
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(10, 11, 12));
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(1, 2, 3));
    cout << vertices.capacity() << endl;
}

```

![image-20221215175247689](/static/images/202206/image-20221215175247689.png)

解决办法：先`reserve`后每次push只拷贝一次。

```cpp
#include <iostream>
#include <vector>
using namespace std;

struct Vertex
{
    float x, y, z;

    Vertex(float x, float y, float z)
        : x(x), y(y), z(z)
    {
    }

    Vertex(const Vertex &vertex)
        : x(vertex.x), y(vertex.y), z(vertex.z)
    {
        std::cout << "Copied!" << std::endl;
    }
};

int main()
{
    std::vector<Vertex> vertices;
    vertices.reserve(5); //加上reserve
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(1, 2, 3));
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(4, 5, 6));
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(7, 8, 9));
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(10, 11, 12));
    cout << vertices.capacity() << endl;
    vertices.push_back(Vertex(1, 2, 3));
    cout << vertices.capacity() << endl;
}
```

![image-20221215175659784](/static/images/202206/image-20221215175659784.png)

更进一步：使用`emplace_back`

```cpp
#include <iostream>
#include <vector>
using namespace std;

struct Vertex
{
    float x, y, z;

    Vertex(float x, float y, float z)
        : x(x), y(y), z(z)
    {
    }

    Vertex(const Vertex &vertex)
        : x(vertex.x), y(vertex.y), z(vertex.z)
    {
        std::cout << "Copied!" << std::endl;
    }
};

int main()
{
    std::vector<Vertex> vertices;
    vertices.reserve(5);
    cout << vertices.capacity() << endl;
    vertices.emplace_back(1, 2, 3);
    cout << vertices.capacity() << endl;
    vertices.emplace_back(4, 5, 6);
    cout << vertices.capacity() << endl;
    vertices.emplace_back(7, 8, 9);
    cout << vertices.capacity() << endl;
    vertices.emplace_back(10, 11, 12);
    cout << vertices.capacity() << endl;
    vertices.emplace_back(1, 2, 3);
    cout << vertices.capacity() << endl;
}
```

![image-20221215180005339](/static/images/202206/image-20221215180005339.png)

## 预编译头文件

在另外一个文件中包含常用的不会修改的头文件并单独编译

`g++ -std=c++11 pch.h`

然后再编译自己的源文件

`g++ -std=c++11 main.cpp -ftime-report`

可以加速编译

## C++基准测试

```cpp
#include <iostream>
#include <chrono>
#include <array>
#include <memory>

class Timer
{
public:
    Timer()
    {
        m_StartTimePoint = std::chrono::high_resolution_clock::now();
    }
    ~Timer()
    {
        Stop();
    }
    void Stop()
    {
        auto endTimePoint = std::chrono::high_resolution_clock::now();
        auto start = std::chrono::time_point_cast<std::chrono::microseconds>(m_StartTimePoint).time_since_epoch().count();
        auto end = std::chrono::time_point_cast<std::chrono::microseconds>(endTimePoint).time_since_epoch().count();

        auto duration = end - start;
        double ms = duration * 0.001;
        std::cout << duration << "us(" << ms << "ms)\n";
    }

private:
    std::chrono::time_point<std::chrono::high_resolution_clock> m_StartTimePoint;
};

int main()
{
    struct vec2
    {
        float x, y;
    };

    {
        std::array<std::shared_ptr<vec2>, 1000> sharedPtrs;
        Timer timer;
        for (int i = 0; i < sharedPtrs.size(); ++i)
        {
            sharedPtrs[i] = std::make_shared<vec2>();
        }
    }

    {
        std::array<std::shared_ptr<vec2>, 1000> sharedPtrs;
        Timer timer;
        for (int i = 0; i < sharedPtrs.size(); ++i)
        {
            sharedPtrs[i] = std::shared_ptr<vec2>(new vec2);
        }
    }

    {
        std::array<std::unique_ptr<vec2>, 1000> sharedPtrs;
        Timer timer;
        for (int i = 0; i < sharedPtrs.size(); ++i)
        {
            sharedPtrs[i] = std::make_unique<vec2>();
        }
    }
}
```

## c++17 结构化绑定处理多返回值

```cpp
#include <iostream>
#include <string>
#include <tuple>

std::tuple<std::string, int> createperson()
{
    return {"chreno", 18};
}

int main()
{
    auto [name, age] = createperson();
    std::cout << name << age << "\n";
}
```

旧方法

```cpp
#include <iostream>
#include <string>
#include <tuple>

// std::pair<std::string,int> CreatPerson() // 只能有两个变量
std::tuple<std::string, int> CreatPerson() // 可以理解为pair的扩展
{
    return {"Cherno", 24};
}

int main()
{
    //元组的数据获取易读性差，还不如像结构体一样直接XXX.age访问更加可读。
    // std::tuple<std::string, int> person = CreatPerson();
     auto person = CreatPerson(); //用auto关键字
     std::string& name = std::get<0>(person);
     int age = std::get<1>(person);

    //tie 可读性好一点
     std::string name;
     int age;
     std::tie(name, age) = CreatPerson();
}
```
