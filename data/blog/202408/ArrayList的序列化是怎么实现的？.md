---
title: ArrayList的序列化是怎么实现的？
date: '2024-08-22'
tags: ['java', '集合']
draft: false
summary: 'java中的类在序列化时，默认调用ObjectOutputStream的defaultWriteObject方法以及ObjectInputStream的defaultReadObject方法，进行序列化和反序列化。在序列化过程中，如果被序列化的类中定义了writeObjec和readObject方法，虚拟机会试图调用对象类里的writeObject和readObject方法，进行用户自定义的序列化和反序列化。'
authors: ['default']
---



在Java编程中，序列化是将对象转换为字节流的过程，反序列化则是将字节流恢复为对象的过程。这一机制使得对象可以在网络上传输或持久化到文件中。而在这一过程中，`ObjectOutputStream` 和 `ObjectInputStream` 类提供了默认的序列化和反序列化方法，即 `defaultWriteObject()` 和 `defaultReadObject()`。

在序列化过程中，如果被序列化的类中定义了writeObjec和readObject方法，虚拟机会试图调用对象类里的writeObject和readObject方法，进行用户自定义的序列化和反序列化。

通过源码可以得知，ArrayList的底层是通过Object数组完成数据存储的，该数组使用transient关键字进行修饰。

> `transient` 是 Java 中的一个关键字，用于修饰类的成员变量。当一个成员变量被声明为 `transient` 时，它告诉 Java 虚拟机不要将其序列化。这意味着在将对象转换为字节流时，`transient` 修饰的成员变量将被忽略，不包含在序列化的数据中。
>
> 在反序列化时，该字段会被初始化为默认值。对于基本数据类型，如 `int`、`boolean`，默认值为对应类型的初始值（例如，`0` 或 `false`）。对于引用类型，如 `String`，默认值为 `null`。因此，如果需要在反序列化后为 `transient` 属性赋予非默认值，需要自行在对象的构造函数或反序列化方法中处理。

```java
/**
 * Shared empty array instance used for empty instances.
 */
private static final Object[] EMPTY_ELEMENTDATA = {};

/**
 * Shared empty array instance used for default sized empty instances. We
 * distinguish this from EMPTY_ELEMENTDATA to know how much to inflate when
 * first element is added.
 */
private static final Object[] DEFAULTCAPACITY_EMPTY_ELEMENTDATA = {};

/**
 * The array buffer into which the elements of the ArrayList are stored.
 * The capacity of the ArrayList is the length of this array buffer. Any
 * empty ArrayList with elementData == DEFAULTCAPACITY_EMPTY_ELEMENTDATA
 * will be expanded to DEFAULT_CAPACITY when the first element is added.
 */
transient Object[] elementData; // non-private to simplify nested class access
```

### **ArrayList为什么要在该字段上加transient关键字？**

ArrayList实际上是动态数组，每次放满后会扩容，增加DEFAULT_CAPACITY，如果数组的容量设为100，而实际只放了一个元素，则其它元素null也会被序列化。因此，为了避免空间浪费，ArrayList把元素数组设置为transient。

其内部自定义了序列化和反序列化方法：

```java	
@java.io.Serial
private void writeObject(java.io.ObjectOutputStream s)
    throws java.io.IOException {
    // Write out element count, and any hidden stuff
    int expectedModCount = modCount;
    s.defaultWriteObject();

    // Write out size as capacity for behavioral compatibility with clone()
    s.writeInt(size);

    // Write out all elements in the proper order.
    for (int i=0; i<size; i++) {
        s.writeObject(elementData[i]);
    }

    if (modCount != expectedModCount) {
        throw new ConcurrentModificationException();
    }
}
@java.io.Serial
private void readObject(java.io.ObjectInputStream s)
    throws java.io.IOException, ClassNotFoundException {

    // Read in size, and any hidden stuff
    s.defaultReadObject();

    // Read in capacity
    s.readInt(); // ignored

    if (size > 0) {
        // like clone(), allocate array based upon size not capacity
        SharedSecrets.getJavaObjectInputStreamAccess().checkArray(s, Object[].class, size);
        Object[] elements = new Object[size];

        // Read in all elements in the proper order.
        for (int i = 0; i < size; i++) {
            elements[i] = s.readObject();
        }

        elementData = elements;
    } else if (size == 0) {
        elementData = EMPTY_ELEMENTDATA;
    } else {
        throw new java.io.InvalidObjectException("Invalid size: " + size);
    }
}
```

可以看到，根据size属性的大小手动处理了元素的序列化。

### **结论**

Java的序列化机制为对象的持久化和传输提供了强大的支持，但也存在一些默认实现无法处理的复杂情况。通过使用 `transient` 关键字和自定义序列化方法，开发者可以精确控制序列化过程，优化性能并避免不必要的资源浪费。理解这些技术细节对于开发健壮且高效的Java应用程序至关重要。

### **常见问题解答**

1. **什么是Java中的序列化？**
   - 序列化是将对象转换为字节流的过程，便于对象的持久化或在网络上传输。
2. **transient关键字在Java中有什么作用？**
   - `transient` 关键字用于标记不需要序列化的字段，避免在序列化过程中浪费资源。
3. **ArrayList为什么要使用transient关键字？**
   - `ArrayList` 使用 `transient` 来标记 `elementData` 数组，避免未使用的数组空间在序列化时浪费存储资源。
4. **如何自定义序列化和反序列化方法？**
   - 在类中定义 `writeObject()` 和 `readObject()` 方法即可自定义序列化逻辑，覆盖默认的序列化行为。
5. **ArrayList的序列化有什么特别之处？**
   - `ArrayList` 自定义了序列化方法，确保只序列化实际存储的元素，避免浪费存储空间。

<font color="red">注：本文中的代码全部基于jdk21</font>