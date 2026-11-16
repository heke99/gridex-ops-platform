"""Fixed local vfs constructor allowance; import and validate are backend-free."""
import hashlib,json,pathlib
P=pathlib.Path
IMAGE='sha256:da6409e5fd135ab8895f0c344f82066d99c107ca1031ed4a1ab1d33f0b775572'
IMAGE_BYTES=820464664
IMAGE_CEILING=784*1048576
BASE_WORKSPACE=336*1048576
CONSTRUCTOR_RESERVE=32*1048576
WORKSPACE_MIN=BASE_WORKSPACE+IMAGE_CEILING+CONSTRUCTOR_RESERVE
TMP_MIN=368*1048576
DRIVER_REF={'path':'/tmp/gridex-ediel-four-case-actual-20261116-a/proper-closure/DOCKER-STORAGE-DRIVER.safe.json','sha256':'05e5dae8040f30b69b335bf7794cc73037a094117628daee2ed94a3a31cc8dc5'}
IMAGE_REF={'path':'/tmp/gridex-ediel-four-case-actual-20261116-a/proper-closure/storage-image-inspect.process.private.json','sha256':'0f0816e33e72e205ca9d1ffb50fa278580949b2c75439d66a62845b3d05a17df'}
def need(v,m):
 if not v:raise AssertionError(m)
def validate(driver,images):
 need(driver=='vfs','ONLY_QUALIFIED_LOCAL_VFS_DRIVER')
 need(isinstance(images,list)and len(images)==1,'ONE_PINNED_LOCAL_STORAGE_IMAGE')
 image=images[0];size=image.get('Size')
 need(image.get('Id')==IMAGE and type(size)is int and size==IMAGE_BYTES and size<=IMAGE_CEILING,'EXACT_IMAGE_ID_SIZE_WITHIN_VFS_COPY_CEILING')
 need(len(image.get('RootFS',{}).get('Layers',[]))==13,'PINNED_THIRTEEN_LAYER_IMAGE')
 need(WORKSPACE_MIN==1207959552 and TMP_MIN==385875968,'FIXED_PURPOSE_ARITHMETIC')
 return {'driver':'vfs','image':IMAGE,'imageBytes':size,'imageCopyCeilingBytes':IMAGE_CEILING,'baseWorkspaceBytes':BASE_WORKSPACE,'constructorReserveBytes':CONSTRUCTOR_RESERVE,'workspaceAvailableBytesMin':WORKSPACE_MIN,'tmpAvailableBytesMin':TMP_MIN,'imageCopyIsWorkspaceNotTMP':True,'allowanceNotGuaranteedPeakBound':True}
def saved_facts():
 values=[]
 for r in [DRIVER_REF,IMAGE_REF]:
  raw=P(r['path']).read_bytes();need(hashlib.sha256(raw).hexdigest()==r['sha256'],'QUALIFIED_DRIVER_IMAGE_EVIDENCE_DRIFT');v=json.loads(raw);need(v['exitCode']==0 and v['stderr']=='','SUCCESSFUL_READONLY_METADATA_REQUIRED');values.append(json.loads(v['stdout']))
 return validate(*values)
def fresh(docker):
 saved_facts()
 # Fixed read-only commands, under the existing caller's finite process cap.
 return validate(json.loads(docker(['info','--format','{{json .Driver}}'])),json.loads(docker(['image','inspect',IMAGE])))
