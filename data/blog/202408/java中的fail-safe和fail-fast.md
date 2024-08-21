---
title: java中的fail-safe和fail-fast
date: '2024-08-21'
tags: ['java', '集合']
draft: false
summary: '在系统设计中，快速失效（fail-fast）系统是一种能够快速立即报告任何可能故障的系统。其目的是为了停止正常操作，而不是为了继续执行可能出错的流程。'
authors: ['default']
---



## 定义
在系统设计中，快速失效（fail-fast）系统是一种能够快速立即报告任何可能故障的系统。其目的是为了停止正常操作，而不是为了继续执行可能出错的流程。

说白了，就是在做系统设计时，要考虑好异常情况，一但发生可能的异常，立即停止。

在java中，非线程安全的集合类有用到fail-fast机制处理并发操作集合时可能出现的异常情况

## 非线程安全集合中的fail-fast

在java中，如果在foreach循环里对某些元素进行元素的remove/add操作时，就会触发fail-fast机制，进而抛出ConcurrentModificationException异常

```java
ArrayList<String> userNames = new ArrayList<>() {{
    add("tx");
    add("txtx");
    add("txtxtx");
    add("txtxtxtx");
}};

for(String name:userNames){
    if(name.equals("tx")){
        userNames.remove(name);
    }
}
System.out.println(userNames);
```

对于以上代码，执行后显示如下

```java	
Exception in thread "main" java.util.ConcurrentModificationException
	at java.base/java.util.ArrayList$Itr.checkForComodification(ArrayList.java:1095)
	at java.base/java.util.ArrayList$Itr.next(ArrayList.java:1049)
	at org.tx.meituan818.main.main(main.java:15)
```

我们跟踪到真正抛出异常的代码中，

```java	
public class ArrayList<E> extends AbstractList<E> ...
    private class Itr implements Iterator<E> {
        final void checkForComodification() {
            if (modCount != expectedModCount)
                throw new ConcurrentModificationException();
        }
```

该代码中，通过比较modCount和expectedModCount，如果二者不相等，则抛出该异常。再看看这两个变量的定义：

```java
/**
 * The number of times this list has been <i>structurally modified</i>.Structural modifications are those that change the size of the list, or otherwise perturb it in such a fashion that iterations in progress may yield incorrect results. 此列表在 结构上被修改的次数。结构修改是指更改列表的大小，或以其他方式扰乱列表，使正在进行的迭代可能会产生错误的结果。
 * <p>This field is used by the iterator and list iterator implementationreturned by the {@code iterator} and {@code listIterator} methods.If the value of this field changes unexpectedly, the iterator (or listiterator) will throw a {@code ConcurrentModificationException} inresponse to the {@code next}, {@code remove}, {@code previous},{@code set} or {@code add} operations.  This provides<i>fail-fast</i> behavior, rather than non-deterministic behavior inthe face of concurrent modification during iteration.此字段由 and listIterator 方法返回iterator的迭代器和列表迭代器实现使用。如果此字段的值意外更改，则迭代器（或列表迭代器）将抛出一个ConcurrentModificationException 以响应 next、 remove、 previousset 或 add 操作。这提供了快速失败的行为，而不是在迭代过程中面对并发修改时的非确	 定性行为
 * <p><b>Use of this field by subclasses is optional.</b> If a subclasswishes to provide fail-fast iterators (and list iterators), then itmerely has to increment this field in its {@code add(int, E)} and{@code remove(int)} methods (and any other methods that it that result in structural modifications to the list).  A single call to{@code add(int, E)} or {@code remove(int)} must add no more than one to this field, or the iterators (and list iterators) will throw bogus {@code ConcurrentModificationExceptions}.  If an implementation does not wish to provide fail-fast iterators, this field may be ignored.
 子类使用此字段是可选的。 如果一个子类希望提供快速失败的迭代器（和列表迭代器），那么它只需要在其 add(int, E) 和 remove(int) 方法（以及它覆盖的导致对列表进行结构修改的任何其他方法）中增加此字段。对此 add(int, E) 字段的单个调用或 remove(int) 必须添加不超过一个，否则迭代器（和列表迭代器）将抛出虚假 ConcurrentModificationExceptions的 。如果实现不希望提供快速失败迭代器，则可以忽略此字段
 */
protected transient int modCount = 0;
```

从注释可以得知，该字段需要配合iterator使用，在基于iterator进行remove或者add时，会不会同时维护这两个字段的值？

```java
public void remove() {
    if (lastRet < 0)
        throw new IllegalStateException();
    checkForComodification();

    try {
        ArrayList.this.remove(lastRet);
        cursor = lastRet;
        lastRet = -1;
        expectedModCount = modCount;
    } catch (IndexOutOfBoundsException ex) {
        throw new ConcurrentModificationException();
    }
}

public E remove(int index) {
    Objects.checkIndex(index, size);
    final Object[] es = elementData;

    @SuppressWarnings("unchecked") E oldValue = (E) es[index];
    fastRemove(es, index);

    return oldValue;
}

private void fastRemove(Object[] es, int i) {
    modCount++;
    final int newSize;
    if ((newSize = size - 1) > i)
        System.arraycopy(es, i + 1, es, i, newSize - i);
    es[size = newSize] = null;
}
```

可以看到，iterator的remove调用了fastremove，然后执行了`expectedModCount = modCount;`

而在使用`userNames.remove(name);`时，直接就执行fastRemove，不会调用这行代码，于是在迭代器进入next时，就会检查到expectedModCount和modCount不相等。

下面再试试用迭代器进行操作：

```java	
Iterator<String> iterator = userNames.iterator();
while (iterator.hasNext()) {
    String name = iterator.next();
    if (name.equals("tx")) {
        iterator.remove();
    }
}
System.out.println(userNames);

#[txtx, txtxtx, txtxtxtx]
```

没有报错。

## 总结

总结一下，之所以会抛出ConcurrentModificationException，是因为我们的代码中使用了增强for循环，而增强for循环是通过iterator进行的，但是remove或者add确实集合类自己的方法，导致iterator在进入到next时，发现字段被意外修改，于是通过fail-fast机制直接报错。

那么问题来了，对于线程安全的集合类还有这个机制吗？线程安全是怎么实现的？且听下回分解😁