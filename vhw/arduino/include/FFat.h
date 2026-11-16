/*
 * FFat（闪存上的 FAT 分区）→ emscripten 内存文件系统里的 /ffat 目录。
 * 文件读写走上游 FS.cpp + vfs_api.cpp（原样编译），只替换"挂载分区"这一步。
 * 刷新页面 = 重新上电，内存文件系统清空（相当于出厂空分区）。
 */
#pragma once
#include "FS.h"

namespace fs {
class F_Fat : public FS {
public:
  F_Fat(FSImplPtr impl);
  bool begin(bool formatOnFail = false, const char* basePath = "/ffat", uint8_t maxOpenFiles = 10, const char* partitionLabel = (char*)"ffat");
  bool format(bool full_wipe = false, char* partitionLabel = (char*)"ffat");
  size_t totalBytes();
  size_t usedBytes();
  size_t freeBytes();
  void end();
};
}  // namespace fs

extern fs::F_Fat FFat;
