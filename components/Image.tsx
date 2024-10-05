'use client'
import NextImage, { ImageProps } from 'next/image'
import React, { useState } from 'react'
import { ImageLightbox } from '@/components/ImageLightbox'
import clsx from 'clsx'
const basePath = process.env.BASE_PATH

// const Image = ({ src, ...rest }: ImageProps) => (
//   <NextImage src={`${basePath || ''}${src}`} {...rest} />
// )

export interface NextImageProps extends ImageProps {
  shouldOpenLightbox?: boolean
}

const Image = ({ shouldOpenLightbox = true, src, ...rest }: NextImageProps) => {
  const [openLightbox, setOpenLightbox] = useState(false)
  const handleOpenLightbox = () => {
    if (!shouldOpenLightbox) return
    document.documentElement.classList.add('lightbox-loading')
    setOpenLightbox(true)
  }
  const isThumb = rest.id === 'thumbnail-image'
  const className = clsx(
    `flex justify-center`,
    shouldOpenLightbox && 'cursor-zoom-in',
    isThumb && 'thumbnail-image',
    rest.alt.endsWith('_M') && `w-1/2 m-auto`,
    rest.alt.endsWith('_S') && `w-1/4 m-auto`
  )

  return (
    <>
      <div
        className={className}
        data-umami-event={isThumb ? 'view-post-thumbnail' : 'view-image-in-lightbox'}
      >
        <NextImage src={`${basePath || ''}${src}`} {...rest} onClick={handleOpenLightbox} />
      </div>
      {openLightbox && (
        <ImageLightbox
          closeLightbox={() => setOpenLightbox(false)}
          src={`${basePath || ''}${src}`}
        />
      )}
    </>
  )
}
export default Image
