/*
 * 编译时强制包含（-include）。ESP32 工具链用 newlib，emscripten 用 musl：
 * 这里补上 newlib 有、musl 没有的少数宏，让上游代码不改就能编译。
 */
#pragma once
#ifndef _GNU_SOURCE
#define _GNU_SOURCE 1
#endif
#include <sys/types.h>
#include <sys/stat.h>
#include <time.h>
#ifndef _IFMT
#define _IFMT S_IFMT
#endif
#ifndef _IFDIR
#define _IFDIR S_IFDIR
#endif
#ifndef _IFREG
#define _IFREG S_IFREG
#endif
#ifndef ACCESSPERMS
#define ACCESSPERMS (S_IRWXU | S_IRWXG | S_IRWXO)
#endif
#ifndef DEFFILEMODE
#define DEFFILEMODE (S_IRUSR | S_IWUSR | S_IRGRP | S_IWGRP | S_IROTH | S_IWOTH)
#endif
