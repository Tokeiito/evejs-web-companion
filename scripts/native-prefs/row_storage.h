// Copyright (c) 2014 CCP ehf. Source port of blue/src/PyRowSet.cpp Get/Set,
// under clientPreferences-LICENSE.txt. Installed3396210 types/converters from
// cdxnumericclassagent1 and cdxctorrowagent1, NOT modern Python3 spelling.
// Scalar/null bytes live in an actual Python bytearray; a Python list owns
// object references for real GC. No Blue/PyObject memory layout is invented.
typedef struct {
  PyObject *columns, *storage;
  char* bytes;
  Py_ssize_t length, count, real;
  long objects, null_start, object_start, type, offset;
} RowView;
static void row_view_close(RowView* v) { decref(v->columns); decref(v->storage); }
static PyObject* row_boundary(PyObject* descriptor, const char* message) {
  PyObject* error = PyObject_GetAttrString(descriptor, "_domain_error");
  if (!error) return NULL;
  PyErr_SetString(error, message); decref(error); return NULL;
}
static int row_view(PyObject* descriptor, RowView* v) {
  memset(v, 0, sizeof(*v));
  PyObject* setting = PyObject_GetAttrString(descriptor, "_setting"); if (!setting) return 0;
  int active = PyObject_IsTrue(setting); decref(setting); if (active < 0) return 0;
  if (active) {
    PyObject *name = PyString_InternFromString("_unsafe"), *truth = PyBool_FromLong(1);
    int status = name && truth ? PyObject_SetAttr(descriptor, name, truth) : -1;
    decref(name); decref(truth); if (status < 0) return 0;
    row_boundary(descriptor, "Reentrant native column-map access is outside the row capability"); return 0;
  }
  PyObject* unsafe = PyObject_GetAttrString(descriptor, "_unsafe"); if (!unsafe) return 0;
  int bad = PyObject_IsTrue(unsafe); decref(unsafe); if (bad < 0) return 0;
  if (bad) { row_boundary(descriptor, "Unsafe descriptor continuation is outside the row capability"); return 0; }
  v->columns = PyObject_GetAttrString(descriptor, "_columns");
  v->storage = PyObject_GetAttrString(descriptor, "_storage");
  if (!v->columns || !v->storage) return 0;
  v->count = PyTuple_Size(v->columns); if (v->count < 0) return 0;
  long fields[5];
  for (int i = 0; i < 5; ++i) {
    PyObject* value = PyTuple_GetItem(v->storage, i); if (!value) return 0;
    fields[i] = PyInt_AsLong(value); if (fields[i] == -1 && PyErr_Occurred()) return 0;
  }
  v->length = fields[0]; v->objects = fields[1]; v->null_start = fields[3]; v->object_start = fields[4];
  int virtual_seen = 0;
  for (Py_ssize_t i = 0; i < v->count; ++i) {
    PyObject* column = PyTuple_GetItem(v->columns, i), *type = column ? PyTuple_GetItem(column, 1) : NULL;
    if (!type) return 0;
    long code = PyInt_AsLong(type); if (code == -1 && PyErr_Occurred()) return 0;
    if (!code) virtual_seen = 1;
    else if (virtual_seen) { row_boundary(descriptor, "Interleaved virtual storage is outside the row capability"); return 0; }
    else ++v->real;
  }
  return 1;
}
static int row_refresh(PyObject* descriptor, PyObject* packed, PyObject* objects, RowView* v) {
  PyObject* unsafe = PyObject_GetAttrString(descriptor, "_unsafe"); if (!unsafe) return 0;
  int bad = PyObject_IsTrue(unsafe); decref(unsafe); if (bad < 0) return 0;
  if (bad) { row_boundary(descriptor, "Unsafe descriptor continuation is outside the row capability"); return 0; }
  PyObject* current = PyObject_GetAttrString(descriptor, "_columns"); if (!current) return 0;
  int same = current == v->columns; decref(current);
  current = PyObject_GetAttrString(descriptor, "_storage"); if (!current) return 0;
  same = same && current == v->storage; decref(current);
  if (!same) { row_boundary(descriptor, "Descriptor mutation during a cell operation is outside the row capability"); return 0; }
  if (PyByteArray_Size(packed) != v->length || PyList_Size(objects) != v->objects) {
    if (!PyErr_Occurred()) row_boundary(descriptor, "Row storage no longer matches its descriptor");
    return 0;
  }
  v->bytes = PyByteArray_AsString(packed); return v->bytes != NULL;
}
static int row_bit(RowView* v, long bit) { return ((unsigned char)v->bytes[bit / 8] >> (bit % 8)) & 1; }
static void row_write_bit(RowView* v, long bit, int value) {
  unsigned char* byte = (unsigned char*)v->bytes + bit / 8;
  if (value) *byte |= (unsigned char)(1u << (bit % 8)); else *byte &= (unsigned char)~(1u << (bit % 8));
}
static int row_column(RowView* v, int index) {
  if (index < 0 || index >= v->count) { PyErr_Format(*exc_index, "index %d out of range", index); return 0; }
  PyObject* column = PyTuple_GetItem(v->columns, index);
  v->type = PyInt_AsLong(PyTuple_GetItem(column, 1)); if (PyErr_Occurred()) return 0;
  v->offset = PyInt_AsLong(PyTuple_GetItem(column, 3)); if (PyErr_Occurred()) return 0;
  if (index < v->real && (v->null_start + index < 0 || (v->null_start + index) / 8 >= v->length)) {
    PyErr_SetString(*exc_runtime, "Invalid row null-bit storage"); return 0;
  }
  long width = v->type == 11 ? 0 : v->type == 16 || v->type == 17 ? 1 : v->type == 2 || v->type == 18 ? 2 :
    v->type == 3 || v->type == 19 || v->type == 4 ? 4 : 8;
  if (v->type == 128 || v->type == 129 || v->type == 130) {
    if (v->offset < 0 || v->offset % 8 || v->offset / 8 - v->object_start < 0 || v->offset / 8 - v->object_start >= v->objects) goto invalid;
  } else if (v->type == 11) {
    if (v->offset < 0 || v->offset / 8 >= v->length) goto invalid;
  } else if (v->type && (v->offset < 0 || v->offset > v->length - width)) goto invalid;
  return 1;
invalid:
  PyErr_SetString(*exc_runtime, "Invalid row column storage"); return 0;
}
static PyObject* row_storage(PyObject* ignored, PyObject* descriptor) {
  RowView v; PyObject *bytes = NULL, *objects = NULL, *answer = NULL;
  if (!row_view(descriptor, &v)) goto done;
  bytes = PyByteArray_FromStringAndSize(NULL, v.length); if (!bytes) goto done;
  memset(PyByteArray_AsString(bytes), 0, (size_t)v.length);
  objects = PyList_New(v.objects); if (!objects) goto done;
  for (long i = 0; i < v.objects; ++i) { Py_IncRef(none_object); PyList_SetItem(objects, i, none_object); }
  answer = PyTuple_New(3); if (!answer) goto done;
  PyTuple_SetItem(answer, 0, bytes); bytes = NULL; PyTuple_SetItem(answer, 1, objects); objects = NULL;
  PyObject* real = PyInt_FromLong((long)v.real); if (!real) { decref(answer); answer = NULL; goto done; }
  PyTuple_SetItem(answer, 2, real);
done:
  row_view_close(&v); decref(bytes); decref(objects); return answer;
}
static PyObject* row_get(PyObject* ignored, PyObject* args) {
  PyObject *descriptor, *packed, *objects, *answer = NULL; int index; RowView v;
  if (!PyArg_ParseTuple(args, "OOOi:row_get", &descriptor, &packed, &objects, &index)) return NULL;
  if (!row_view(descriptor, &v)) goto done;
  if (!row_refresh(descriptor, packed, objects, &v) || !row_column(&v, index)) goto done;
  if (index < v.real && row_bit(&v, v.null_start + index)) { answer = new_none(); goto done; }
  char* p = v.bytes;
  if (v.type && v.type != 11 && v.type != 128 && v.type != 129 && v.type != 130) p += v.offset;
  int8_t i1; uint8_t u1; int16_t i2; uint16_t u2; int32_t i4; int64_t i8; uint64_t u8; float r4; double r8;
  switch (v.type) {
    case 16: memcpy(&i1,p,1); answer=PyInt_FromLong(i1); break;
    case 17: memcpy(&u1,p,1); answer=PyInt_FromLong(u1); break;
    case 2: memcpy(&i2,p,2); answer=PyInt_FromLong(i2); break;
    case 18: memcpy(&u2,p,2); answer=PyInt_FromLong(u2); break;
    case 3: case 19: memcpy(&i4,p,4); answer=PyInt_FromLong(i4); break;
    case 20: memcpy(&i8,p,8); answer=PyLong_FromLongLong(i8); break;
    case 21: case 64: memcpy(&u8,p,8); answer=PyLong_FromUnsignedLongLong(u8); break;
    case 4: memcpy(&r4,p,4); answer=PyFloat_FromDouble(r4); break;
    case 5: memcpy(&r8,p,8); answer=PyFloat_FromDouble(r8); break;
    case 6: memcpy(&i8,p,8); answer=PyFloat_FromDouble((double)i8/10000.0); break;
    case 11: answer=PyBool_FromLong(row_bit(&v,v.offset)); break;
    case 128: case 129: case 130: answer=PyList_GetItem(objects,v.offset/8-v.object_start); if(answer)Py_IncRef(answer); break;
    default: PyErr_Format(*exc_runtime,"Unexpected db column type encountered: %d",(int)v.type);
  }
done:
  row_view_close(&v); return answer;
}
static PyObject* row_set(PyObject* ignored, PyObject* args) {
  PyObject *descriptor, *packed, *objects, *value, *answer = NULL; int index; RowView v;
  if (!PyArg_ParseTuple(args,"OOOiO:row_set",&descriptor,&packed,&objects,&index,&value))return NULL;
  if (!row_view(descriptor,&v))goto done;
  if (!row_refresh(descriptor,packed,objects,&v)||!row_column(&v,index))goto done;
  if (value==none_object && index<v.real) {
    if (v.type==128||v.type==129||v.type==130) { Py_IncRef(value); if(PyList_SetItem(objects,v.offset/8-v.object_start,value)<0)goto done; }
    if(!row_refresh(descriptor,packed,objects,&v))goto done;
    row_write_bit(&v,v.null_start+index,1); answer=new_none(); goto done;
  }
  long integer=0; long long signed64=0; unsigned long long unsigned64=0; double real=0; int truth=0;
  switch(v.type) {
    case 16: case 17: case 2: case 18: case 3: case 19: integer=PyInt_AsLong(value); if(integer==-1&&PyErr_Occurred())goto done; break;
    case 20: signed64=PyLong_AsLongLong(value); if(signed64==-1&&PyErr_Occurred())goto done; break;
    case 21: case 64: unsigned64=PyLong_AsUnsignedLongLong(value); if(unsigned64==(unsigned long long)-1&&PyErr_Occurred())goto done; break;
    case 4: case 5: case 6: real=PyFloat_AsDouble(value); if(real==-1.0&&PyErr_Occurred())goto done; break;
    case 11: truth=PyObject_IsTrue(value); if(truth<0)goto done; break; // Throwing truth hooks are outside the native pending-error domain.
    case 128: case 129: case 130: break;
    case 0: PyErr_SetString(*exc_runtime,"Virtual columns are read-only"); goto done;
    default: PyErr_Format(*exc_runtime,"Unexpected db column type encountered: %d",(int)v.type); goto done;
  }
  if(!row_refresh(descriptor,packed,objects,&v))goto done;
  char* p=v.bytes; if(v.type!=11&&v.type!=128&&v.type!=129&&v.type!=130)p+=v.offset;
  int truncated=0; int8_t i1=(int8_t)integer; uint8_t u1=(uint8_t)integer; int16_t i2=(int16_t)integer; uint16_t u2=(uint16_t)integer; int32_t i4=(int32_t)integer; float r4=(float)real;
  switch(v.type) {
    case 16: memcpy(p,&i1,1); truncated=i1!=integer; break;
    case 17: memcpy(p,&u1,1); truncated=u1!=integer; break;
    case 2: memcpy(p,&i2,2); truncated=i2!=integer; break;
    case 18: memcpy(p,&u2,2); truncated=u2!=integer; break;
    case 3: case 19: memcpy(p,&i4,4); break;
    case 20: memcpy(p,&signed64,8); break;
    case 21: case 64: memcpy(p,&unsigned64,8); break;
    case 4: memcpy(p,&r4,4); truncated=(double)r4!=real; break;
    case 5: memcpy(p,&real,8); break;
    case 6: {
      double rounded=floor(real*100.0+0.5)*100.0;
      if(!isfinite(rounded)||rounded < -9223372036854775808.0||rounded>=9223372036854775808.0) {row_boundary(descriptor,"Out-of-range native currency cast is outside this capability");goto done;}
      signed64=(long long)rounded; memcpy(p,&signed64,8); break;
    }
    case 11: row_write_bit(&v,v.offset,truth); break;
    case 128: case 129: case 130: Py_IncRef(value); if(PyList_SetItem(objects,v.offset/8-v.object_start,value)<0)goto done; break;
  }
  // Original narrow setters write BEFORE warning; warning-as-error preserves
  // those bytes and the previous NULL bit. Normal object/finalizer reentry
  // ordering remains explicitly outside this named source-port capability.
  if(truncated&&PyErr_WarnEx(*exc_warning,v.type==4?"float was truncated":"integer was truncated",1))goto done;
  if(!row_refresh(descriptor,packed,objects,&v))goto done;
  if(index<v.real)row_write_bit(&v,v.null_start+index,0);
  answer=new_none();
done:
  row_view_close(&v); return answer;
}
static PyObject* row_index(PyObject* ignored,PyObject* args) {
  PyObject *descriptor,*key,*kind,*answer=NULL; int allow_missing=0; RowView v;
  if(!PyArg_ParseTuple(args,"OO|i:row_index",&descriptor,&key,&allow_missing))return NULL;
  if(!row_view(descriptor,&v))goto done;
  kind=PyObject_Type(key);if(!kind)goto done;
  int string=PyType_IsSubtype(kind,str_type),integer=PyType_IsSubtype(kind,int_type);decref(kind);
  if(string) {
    char *target;Py_ssize_t length;if(PyString_AsStringAndSize(key,&target,&length))goto done;
    for(Py_ssize_t i=0;i<v.count;++i){PyObject* c=PyTuple_GetItem(v.columns,i);char* name;if(PyString_AsStringAndSize(PyTuple_GetItem(c,0),&name,&length))goto done;if(!strcmp(target,name)){answer=PyInt_FromLong((long)i);goto done;}}
    if(allow_missing)answer=new_none();else PyErr_Format(*exc_key,"Row has no field %s",target);
  } else if(integer) {
    long original=PyInt_AsLong(key);if(original==-1&&PyErr_Occurred())goto done;
    Py_ssize_t index=original;if(index<0)index+=v.count;
    if(index<0||index>=v.count)PyErr_Format(*exc_index,"index %d out of range",(int)original);else answer=PyInt_FromLong((long)index);
  } else PyErr_SetString(*exc_type,"only integers or strings supported");
done:row_view_close(&v);return answer;
}
static PyObject* row_sequence_size(PyObject* ignored,PyObject* value){Py_ssize_t n=PySequence_Size(value);return n<0?NULL:n<=LONG_MAX?PyInt_FromLong((long)n):PyLong_FromLongLong(n);}
static PyObject* row_sequence_item(PyObject* ignored,PyObject* args){PyObject* seq;Py_ssize_t index;if(!PyArg_ParseTuple(args,"On:row_sequence_item",&seq,&index))return NULL;return PySequence_GetItem(seq,index);}
static PyObject* row_sequence_fast(PyObject* ignored,PyObject* value){return PySequence_Fast(value,"must assign a sequence");}
static PyObject* row_warning(PyObject* ignored,PyObject* args){const char* message;if(!PyArg_ParseTuple(args,"s:row_warning",&message))return NULL;if(PyErr_WarnEx(*exc_warning,message,1))return NULL;return new_none();}
static PyObject* row_compare(PyObject* ignored,PyObject* args){PyObject *a,*b;int result;if(!PyArg_ParseTuple(args,"OO:row_compare",&a,&b))return NULL;if(PyObject_Cmp(a,b,&result)<0)return NULL;return PyInt_FromLong(result);}
