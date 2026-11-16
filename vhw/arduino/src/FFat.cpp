/* FFat → emscripten 内存文件系统里的挂载目录（文件读写走上游 vfs_api.cpp）。 */
#include "FFat.h"

#include <errno.h>
#include <sys/stat.h>

#include "vfs_api.h"

using namespace fs;

F_Fat::F_Fat(FSImplPtr impl) : FS(impl) {}

bool F_Fat::begin(bool formatOnFail, const char* basePath, uint8_t maxOpenFiles, const char* label) {
  (void)formatOnFail; (void)maxOpenFiles; (void)label;
  if (::mkdir(basePath, 0777) != 0 && errno != EEXIST) return false;
  _impl->mountpoint(basePath);
  return true;
}
bool F_Fat::format(bool full_wipe, char* label) { (void)full_wipe; (void)label; return true; }
size_t F_Fat::totalBytes() { return 4u * 1024u * 1024u; }
size_t F_Fat::usedBytes() { return 0; }
size_t F_Fat::freeBytes() { return totalBytes(); }
void F_Fat::end() { _impl->mountpoint(NULL); }

F_Fat FFat = F_Fat(FSImplPtr(new VFSImpl()));
